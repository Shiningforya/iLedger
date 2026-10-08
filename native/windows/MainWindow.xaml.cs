using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using System.Text.Json.Nodes;
using Windows.Storage.Pickers;
namespace ILedger;

public sealed partial class MainWindow : Window {
    private LedgerStore? store;
    private JsonObject state=new();
    private string section="dashboard";
    private int page=1,pages=1;
    private bool dialogOpen;
    public sealed record Row(string Title,string Detail,JsonObject Value);
    public MainWindow(){
        InitializeComponent();
        if(Microsoft.UI.Composition.SystemBackdrops.MicaController.IsSupported())SystemBackdrop=new MicaBackdrop();
        Closed+=(_,_)=>store?.Dispose();
        ((FrameworkElement)Content).Loaded+=async(_,_)=>{try{store=await Task.Run(()=>new LedgerStore());await Refresh();}catch(Exception e){Error(e);}};
    }
    private void Error(Exception error){Feedback.Message=error.Message;Feedback.Severity=InfoBarSeverity.Error;Feedback.IsOpen=true;}
    private async Task Refresh(){
        if(store==null)return;
        state=await store.Execute(new JsonObject{["action"]="snapshot"});
        IEnumerable<JsonObject> rows;
        if(section=="dashboard") {
            var summary=await store.Execute(new JsonObject{["action"]="summary",["year"]=DateTime.Today.Year.ToString()});
            Records.ItemsSource=new[]{new Row("总收入",$"{state.Text("baseCurrency")} {summary.Number("income"):N2}",new()),new Row("总支出",$"{state.Text("baseCurrency")} {summary.Number("expense"):N2}",new()),new Row("收支差",$"{state.Text("baseCurrency")} {summary.Number("net"):N2}",new())}
                .Concat(summary.Rows("months").Select(m=>new Row($"{m.Number("month")} 月",$"收入 {m.Number("income"):N2} · 支出 {m.Number("expense"):N2}",new()))).ToList();
            PageLabel.Text="年度 1–12 月";return;
        }
        if(section=="settings"){Records.ItemsSource=new[]{new Row("后续记账本币",state.Text("baseCurrency"),new JsonObject{["settings"]=true}),new Row("iLedger Native",System.Reflection.Assembly.GetExecutingAssembly().GetName().Version?.ToString() ?? "",new())};PageLabel.Text="";return;}
        var transactions=section is "transactions" or "income" or "expense";
        rows=state.Rows(transactions?"transactions":section).Where(r=>section is not ("income" or "expense")||r.Text("type")==section).OrderByDescending(r=>r.Text("date"));
        var all=rows.ToList();pages=Math.Max(1,(all.Count+19)/20);page=Math.Clamp(page,1,pages);
        Records.ItemsSource=all.Skip((page-1)*20).Take(20).Select(r=>new Row(r.Text(transactions?"item":"name"),Detail(r,transactions),r)).ToList();
        PageLabel.Text=$"{page} / {pages} · {all.Count} 条";
    }
    private string Detail(JsonObject row,bool transaction){
        if(transaction)return $"{row.Text("date")} · {row.Text("category")} · {row.Text("currency")} {row.Number("amount"):N2} · {row.Text("bookedBaseCurrency")} {row.Number("amountInBase"):N2}";
        if(section=="accounts")return string.IsNullOrEmpty(row.Text("parentAccountId"))?"主账户":$"{row.Text("currency")} {row.Number("balance"):N2}";
        if(section=="rates")return $"{row.Text("code")} · {row.Number("rateToCny")} CNY";
        return row.Text("endsAt",row.Text("purchasedAt",row.Text("status",row.Text("type"))));
    }
    private async void Navigate(NavigationView sender,NavigationViewSelectionChangedEventArgs args){section=args.IsSettingsSelected?"settings":(args.SelectedItem as NavigationViewItem)?.Tag?.ToString()??"dashboard";page=1;Navigation.Header=args.IsSettingsSelected?"设置":(args.SelectedItem as NavigationViewItem)?.Content;try{await Refresh();}catch(Exception e){Error(e);}}
    private async void Previous(object sender,RoutedEventArgs e){page=Math.Max(1,page-1);try{await Refresh();}catch(Exception error){Error(error);}}
    private async void Next(object sender,RoutedEventArgs e){page=Math.Min(pages,page+1);try{await Refresh();}catch(Exception error){Error(error);}}
    private async void NewExpense(object sender,RoutedEventArgs e)=>await Edit("transactions",new JsonObject{["type"]="expense"});
    private async void NewIncome(object sender,RoutedEventArgs e)=>await Edit("transactions",new JsonObject{["type"]="income"});
    private async void NewEntity(object sender,RoutedEventArgs e){if(section is "accounts" or "categories" or "rates")await Edit(section,new());}
    private async void EditRow(object sender,ItemClickEventArgs e){if(e.ClickedItem is Row row){if(section=="settings"&&row.Value.ContainsKey("settings"))await Edit("settings",new());else if(section!="dashboard"&&section!="settings")await Edit(section is "income" or "expense"?"transactions":section,row.Value);}}
    private async Task Edit(string kind,JsonObject original){
        if(dialogOpen||store==null)return;dialogOpen=true;
        try {
            var value=(JsonObject)original.DeepClone();var form=new StackPanel{Spacing=12,MinWidth=360};var controls=new Dictionary<string,Func<JsonNode?>>();
            void Field(string key,string label,bool number=false,string fallback="") {var box=new TextBox{Header=label,Text=value.Text(key,fallback)};form.Children.Add(box);controls[key]=()=>number?JsonValue.Create(double.Parse(box.Text,System.Globalization.CultureInfo.InvariantCulture)):JsonValue.Create(box.Text);}
            void Choice(string key,string label,IEnumerable<(string Id,string Name)> choices,string fallback=""){var options=choices.ToList();var box=new ComboBox{Header=label,HorizontalAlignment=HorizontalAlignment.Stretch};foreach(var item in options)box.Items.Add(new ComboBoxItem{Content=item.Name,Tag=item.Id});box.SelectedIndex=options.FindIndex(o=>o.Id==value.Text(key,fallback));if(box.SelectedIndex<0&&options.Count>0)box.SelectedIndex=0;form.Children.Add(box);controls[key]=()=>JsonValue.Create((box.SelectedItem as ComboBoxItem)?.Tag?.ToString()??"");}
            var baseCurrency=state.Text("baseCurrency","CNY");
            if(kind=="transactions"){
                Field("item","项目名称");Choice("type","收支类型",new[]{("expense","支出"),("income","收入")},"expense");Field("amount","金额",true,"0");
                Choice("currency","币种",state.Rows("rates").Select(r=>(r.Text("code"),r.Text("code"))),baseCurrency);
                Choice("category","类别",state.Rows("categories").Select(r=>(r.Text("name"),r.Text("name"))));
                Choice("accountId","子账户",state.Rows("accounts").Where(r=>r.Text("parentAccountId")!="").Select(r=>(r.Text("id"),r.Text("name")+" · "+r.Text("currency"))));
                Field("date","日期 YYYY-MM-DD",false,DateTime.Today.ToString("yyyy-MM-dd"));Field("note","备注");
            }else if(kind=="accounts"){
                Field("name","名称");Choice("parentAccountId","层级",new[]{("","主账户")}.Concat(state.Rows("accounts").Where(r=>r.Text("parentAccountId")==""&&r.Text("id")!=value.Text("id")).Select(r=>(r.Text("id"),"子账户 · "+r.Text("name")))));
                if(!original.ContainsKey("id"))Field("childName","首个子账户名称（新建主账户时填写）");Choice("currency","币种",state.Rows("rates").Select(r=>(r.Text("code"),r.Text("code"))),baseCurrency);Field("balance","余额",true,"0");
            }else if(kind=="categories"){Field("name","名称");Choice("type","收支类型",new[]{("expense","支出"),("income","收入")},"expense");}
            else if(kind=="rates"){Field("code","代码");Field("name","名称");Field("rateToCny","1 单位兑换 CNY",true,"1");}
            else if(kind=="settings"){Choice("baseCurrency","后续记账本币",state.Rows("rates").Select(r=>(r.Text("code"),r.Text("code"))),baseCurrency);}
            else {Field("name","名称");if(kind=="subscriptions"){Field("amount","金额",true);Field("startedAt","开始日期");Field("endsAt","到期日期");}if(kind=="assets"){Field("price","原价",true);Field("purchasedAt","购入日期");Field("lifeDays","折旧天数",true);}if(kind=="loans"){Field("principal","本金",true);Field("borrowedAt","借入日期");Field("dueDate","约定还款日");}}
            var dialog=new ContentDialog{XamlRoot=((FrameworkElement)Content).XamlRoot,Title="编辑记录",Content=new ScrollViewer{Content=form,MaxHeight=480},PrimaryButtonText="保存",CloseButtonText="取消",DefaultButton=ContentDialogButton.Primary};
            dialog.PrimaryButtonClick+=async(_,args)=>{
                var deferral=args.GetDeferral();
                try{
                    foreach(var (key,read) in controls)value[key]=read();
                    var action=kind switch{"transactions"=>"saveTransaction","accounts"=>"saveAccount","categories"=>"saveCategory","rates"=>"saveRate","settings"=>"settings",_=>"saveManaged"};
                    var request=new JsonObject{["action"]=action,["value"]=value.DeepClone(),["collection"]=kind};
                    if(kind=="accounts"&&!original.ContainsKey("id")&&value.Text("parentAccountId")=="")request["initialChild"]=new JsonObject{["name"]=value.Text("childName"),["currency"]=value.Text("currency"),["balance"]=value.Number("balance")};
                    await store.Execute(request);await Refresh();
                }catch(Exception error){args.Cancel=true;Error(error);}finally{deferral.Complete();}
            };
            await dialog.ShowAsync();
        }catch(Exception error){Error(error);}finally{dialogOpen=false;}
    }
    private async void Export(object sender,RoutedEventArgs e){try{var picker=new FileSavePicker{SuggestedFileName=$"iLedger-{DateTime.Today:yyyy-MM-dd}"};picker.FileTypeChoices.Add("JSON 账本",new List<string>{".json"});WinRT.Interop.InitializeWithWindow.Initialize(picker,WinRT.Interop.WindowNative.GetWindowHandle(this));var file=await picker.PickSaveFileAsync();if(file!=null)await Windows.Storage.FileIO.WriteTextAsync(file,state.ToJsonString());}catch(Exception error){Error(error);}}
    private async void Import(object sender,RoutedEventArgs e){if(dialogOpen||store==null)return;try{var picker=new FileOpenPicker();picker.FileTypeFilter.Add(".json");WinRT.Interop.InitializeWithWindow.Initialize(picker,WinRT.Interop.WindowNative.GetWindowHandle(this));var file=await picker.PickSingleFileAsync();if(file==null)return;var data=JsonNode.Parse(await Windows.Storage.FileIO.ReadTextAsync(file))!.AsObject();var dialog=new ContentDialog{XamlRoot=((FrameworkElement)Content).XamlRoot,Title="替换原生候选版账本？",Content="请先导出当前账本备份。不会修改旧版应用数据。",PrimaryButtonText="确认替换",CloseButtonText="取消"};dialogOpen=true;if(await dialog.ShowAsync()==ContentDialogResult.Primary){await store.Execute(new JsonObject{["action"]="import",["value"]=(data["state"]??data).DeepClone()});await Refresh();}}catch(Exception error){Error(error);}finally{dialogOpen=false;}}
}
