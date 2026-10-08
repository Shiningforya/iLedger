package com.iledger.nativeapp

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.mapSaver
import androidx.compose.runtime.snapshots.SnapshotStateMap
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.io.ByteArrayOutputStream
import androidx.lifecycle.compose.collectAsStateWithLifecycle

@Composable fun Choice(label: String, value: String, options: List<Pair<String,String>>, onChange: (String)->Unit) {
    var expanded by remember { mutableStateOf(false) }
    Column {
        Text(label,style=MaterialTheme.typography.labelMedium)
        Box {
            OutlinedButton(onClick={expanded=true},modifier=Modifier.fillMaxWidth()) { Text(options.firstOrNull { it.first==value }?.second ?: "请选择") }
            DropdownMenu(expanded=expanded,onDismissRequest={expanded=false}) { options.forEach { (key,name) -> DropdownMenuItem(text={Text(name)},onClick={onChange(key);expanded=false}) } }
        }
    }
}

@Composable fun EditorDialog(model: LedgerModel, route: JSONObject, state: JSONObject) {
    val ui by model.ui.collectAsStateWithLifecycle()
    val kind=route.getString("kind");val original=route.optJSONObject("value") ?: JSONObject()
    val fields=rememberSaveable(saver=mapSaver<SnapshotStateMap<String,String>>(
        save={it.toMap()},restore={saved->mutableStateMapOf<String,String>().apply{saved.forEach{(key,value)->put(key,value as String)}}}
    )) { mutableStateMapOf<String,String>().apply {
        original.keys().forEach { key -> put(key,original.optString(key)) }
        putIfAbsent("type","expense");putIfAbsent("currency",state.optString("baseCurrency","CNY"));putIfAbsent("date",LocalDate.now().toString());putIfAbsent("balance","0")
        putIfAbsent("category",state.rows("categories").firstOrNull { it.optString("type")==get("type") }?.optString("name") ?: "")
        val account=state.rows("accounts").firstOrNull { it.optString("id")==get("accountId") }
        putIfAbsent("parentAccountId",account?.optString("parentAccountId") ?: "")
        put("aliases",original.optJSONArray("aliases")?.let { array -> (0 until array.length()).joinToString(", "){array.optString(it)} } ?: "")
    } }
    var subscription by rememberSaveable { mutableStateOf(original.optString("subscriptionId").isNotEmpty()) }
    var asset by rememberSaveable { mutableStateOf(original.optString("assetId").isNotEmpty()) }
    var credit by rememberSaveable { mutableStateOf(state.rows("creditTools").any { it.optString("accountId")==original.optString("id") && original.has("id") }) }
    val children=state.rows("accounts").filter { it.optString("parentAccountId").isNotEmpty() }
    val parents=state.rows("accounts").filter { it.optString("parentAccountId").isEmpty() }
    val base=original.optString("bookedBaseCurrency",state.optString("baseCurrency","CNY"))
    fun rate(code: String)=state.rows("rates").firstOrNull { it.optString("code")==code }?.optDouble("rateToCny",1.0) ?: 1.0
    LaunchedEffect(fields["currency"]) {
        if(!fields.containsKey("exchangeRateToBase") || fields["currency"]!=original.optString("currency")) fields["exchangeRateToBase"]=(rate(fields["currency"] ?: base)/rate(base)).toString()
    }
    LaunchedEffect(Unit) {
        state.rows("subscriptions").firstOrNull { it.optString("id")==original.optString("subscriptionId") }?.let { sub -> fields.putIfAbsent("subscriptionEndsAt",sub.optString("endsAt"));fields.putIfAbsent("subscriptionCycle",sub.optString("cycle"));fields.putIfAbsent("subscriptionMode",sub.optString("renewalMode")) }
        state.rows("assets").firstOrNull { it.optString("id")==original.optString("assetId") }?.let { fields.putIfAbsent("assetLifeDays",it.optString("lifeDays")) }
        state.rows("creditTools").firstOrNull { it.optString("accountId")==original.optString("id") }?.let { fields.putIfAbsent("statementDay",it.optString("statementDay"));fields.putIfAbsent("repaymentDay",it.optString("repaymentDay")) }
    }
    Dialog(onDismissRequest=model::pop,properties=DialogProperties(usePlatformDefaultWidth=false,decorFitsSystemWindows=false)) {
        BackHandler { model.pop() }
        Surface(Modifier.fillMaxWidth(.95f).fillMaxHeight(.92f).safeDrawingPadding().imePadding(),shape=MaterialTheme.shapes.large,tonalElevation=6.dp) {
            Column(Modifier.padding(16.dp).testTag("editor-$kind")) {
                Row(verticalAlignment=Alignment.CenterVertically) { Text(if(kind=="recognition") "文字记账" else "编辑${sections.firstOrNull { it.first==kind }?.second ?: "记录"}",style=MaterialTheme.typography.titleLarge,modifier=Modifier.weight(1f)); IconButton(onClick=model::pop){Icon(Icons.Default.Close,"关闭表单")} }
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(10.dp)) {
                    @Composable fun field(key: String,label: String) { OutlinedTextField(fields[key] ?: "",{fields[key]=it},label={Text(label)},modifier=Modifier.fillMaxWidth(),singleLine=true) }
                    @Composable fun currencies() { Choice("币种",fields["currency"] ?: base,state.rows("rates").map { it.optString("code") to "${it.optString("code")} · ${it.optString("name")}" }){fields["currency"]=it} }
                    when(kind) {
                        "recognition" -> OutlinedTextField(fields["text"] ?: "",{fields["text"]=it},label={Text("记账内容")},modifier=Modifier.fillMaxWidth().heightIn(min=130.dp))
                        "transactions" -> {
                            Choice("收支类型",fields["type"] ?: "expense",listOf("expense" to "支出","income" to "收入")){fields["type"]=it;fields["category"]=state.rows("categories").firstOrNull { category -> category.optString("type")==it }?.optString("name") ?: ""}
                            field("item","项目名称");field("amount","金额");currencies()
                            if(fields["currency"]!=base) field("exchangeRateToBase","汇率 → $base")
                            Row(verticalAlignment=Alignment.CenterVertically) {
                                Box(Modifier.weight(1f)) { Choice("类别",fields["category"] ?: "",state.rows("categories").filter { it.optString("type")==fields["type"] }.map { it.optString("name") to it.optString("name") }){fields["category"]=it} }
                                IconButton(onClick={model.push("categories",json("type" to fields["type"]))}) { Icon(Icons.Default.Add,"新建类别") }
                            }
                            Choice("主账户",fields["parentAccountId"] ?: "",parents.map { it.optString("id") to it.optString("name") }) { fields["parentAccountId"]=it;fields["accountId"]="" }
                            Row(verticalAlignment=Alignment.CenterVertically) {
                                Box(Modifier.weight(1f)) { Choice("子账户",fields["accountId"] ?: "",children.filter { it.optString("parentAccountId")==fields["parentAccountId"] }.map { it.optString("id") to "${it.optString("name")} · ${it.optString("currency")}" }){fields["accountId"]=it} }
                                IconButton(onClick={model.push("accounts",json("parentAccountId" to fields["parentAccountId"]))}) { Icon(Icons.Default.Add,"新建子账户") }
                            }
                            field("date","日期 YYYY-MM-DD")
                            if(fields["category"]=="借款") field("loanDueDate","约定还款日期")
                            if(fields["type"]=="expense") {
                                Row(verticalAlignment=Alignment.CenterVertically) { Checkbox(subscription,{subscription=it});Text("订阅项目") }
                                if(subscription) field("subscriptionEndsAt","订阅到期日 YYYY-MM-DD")
                                Row(verticalAlignment=Alignment.CenterVertically) { Checkbox(asset,{asset=it});Text("资产折旧") }
                                if(asset) field("assetLifeDays","折旧天数")
                            };field("note","备注")
                        }
                        "accounts" -> {
                            field("name","账户名称")
                            if(!original.has("id")) Choice("账户层级",fields["parentAccountId"] ?: "",listOf("" to "主账户")+parents.map { it.optString("id") to "子账户 · ${it.optString("name")}" }) { fields["parentAccountId"]=it }
                            if(fields["parentAccountId"].isNullOrEmpty() && !original.has("id")) field("childName","首个子账户名称")
                            if(!fields["parentAccountId"].isNullOrEmpty() || !original.has("id")) { currencies();field("balance","余额") }
                            if(!fields["parentAccountId"].isNullOrEmpty()) {
                                field("aliases","识别库关键词，逗号分隔")
                                Row(verticalAlignment=Alignment.CenterVertically) { Checkbox(credit,{credit=it});Text("信用账户") }
                                if(credit){field("statementDay","每月出账日");field("repaymentDay","每月还款日")}
                            }
                        }
                        "categories" -> { field("name","名称");Choice("收支类型",fields["type"] ?: "expense",listOf("expense" to "支出","income" to "收入")){fields["type"]=it};field("aliases","识别库关键词，逗号分隔") }
                        "rates" -> { field("code","代码");field("name","名称");field("rateToCny","1 单位兑换 CNY");field("aliases","识别库关键词") }
                        "subscriptions" -> { field("name","名称");field("amount","金额");field("startedAt","开始日期");field("endsAt","到期日期") }
                        "assets" -> {field("name","名称");field("price","原价");field("purchasedAt","购入日期");field("lifeDays","折旧天数")}
                        "loans" -> {field("name","名称");field("principal","本金");field("borrowedAt","借入日期");field("dueDate","约定还款日")}
                    }
                }
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.End) {
                    TextButton(onClick=model::pop){Text("取消")}
                    Button(onClick={
                        if(kind=="recognition") { model.parse(fields["text"] ?: "");return@Button }
                        val value=JSONObject(original.toString());fields.forEach { (key,text)->value.put(key,text) }
                        for(key in listOf("amount","balance","exchangeRateToBase","assetLifeDays","rateToCny","price","principal","lifeDays")) if(fields.containsKey(key)) {
                            val number=fields[key]?.toDoubleOrNull()
                            if(number==null || !number.isFinite()){model.report("请输入有效数字：$key");return@Button};value.put(key,number)
                        }
                        value.put("aliases",JSONArray((fields["aliases"] ?: "").split(',', '，').map { it.trim() }.filter { it.isNotEmpty() }))
                        val request=json("value" to value)
                        when(kind) {
                            "transactions" -> {
                                request.put("action","saveTransaction");value.put("isSubscription",subscription);value.put("trackDepreciation",asset)
                                val tool=state.rows("creditTools").firstOrNull { it.optString("accountId")==fields["accountId"] }
                                value.put("paymentKind",if(tool!=null && fields["type"]=="expense") "credit" else "normal");if(tool!=null)value.put("creditToolId",tool.optString("id")) else value.remove("creditToolId")
                            }
                            "accounts" -> { request.put("action","saveAccount");if(fields["parentAccountId"].isNullOrEmpty()) request.put("initialChild",json("name" to fields["childName"],"currency" to fields["currency"],"balance" to value.optDouble("balance",0.0))) else request.put("credit",if(credit) json("statementDay" to fields["statementDay"]?.toIntOrNull(),"repaymentDay" to fields["repaymentDay"]?.toIntOrNull()) else JSONObject.NULL) }
                            "categories" -> request.put("action","saveCategory")
                            "rates" -> request.put("action","saveRate")
                            else -> {request.put("action","saveManaged");request.put("collection",kind)}
                        }
                        model.command(request,model::pop)
                    },enabled=!ui.busy,modifier=Modifier.testTag("editor-save")){Text(if(kind=="recognition") "识别" else "保存")}
                }
            }
        }
    }
}

@Composable fun SettingsScreen(model: LedgerModel, state: JSONObject) {
    val context=LocalContext.current;val scope=rememberCoroutineScope()
    var pendingImport by remember { mutableStateOf<JSONObject?>(null) }
    var restoreImport by rememberSaveable { mutableStateOf(false) }
    val open=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> if(uri!=null) scope.launch {
        runCatching { withContext(Dispatchers.IO) { context.contentResolver.openInputStream(uri).use { input ->
            check(input!=null)
            val output=ByteArrayOutputStream();val buffer=ByteArray(8192)
            while(true){val count=input.read(buffer);if(count<0)break;check(output.size()+count<=100*1024*1024){"文件过大"};output.write(buffer,0,count)}
            JSONObject(output.toString("UTF-8"))
        } } }.onSuccess { pendingImport=it.optJSONObject("state") ?: it }.onFailure { model.report(it.message ?: "导入失败") }
    } }
    val export=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri -> if(uri!=null) scope.launch {
        runCatching { withContext(Dispatchers.IO) { context.contentResolver.openOutputStream(uri).use { output -> check(output!=null);output.write(state.toString(2).toByteArray()) } } }.onFailure { model.report(it.message ?: "导出失败") }
    } }
    Column(Modifier.padding(20.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(16.dp)) {
        Text("iLedger Native ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})",style=MaterialTheme.typography.titleMedium)
        Choice("后续记账本币",state.optString("baseCurrency","CNY"),state.rows("rates").map { it.optString("code") to "${it.optString("code")} · ${it.optString("name")}" }) { model.command(json("action" to "settings","value" to json("baseCurrency" to it))) }
        OutlinedButton(onClick={open.launch(arrayOf("application/json","text/plain"))}){Text("导入账本 JSON")}
        OutlinedButton(onClick={export.launch("iLedger-${LocalDate.now()}.json")}){Text("导出账本备份")}
        OutlinedButton(onClick={restoreImport=true}){Text("撤销上次导入")}
    }
    if(pendingImport!=null) AlertDialog(onDismissRequest={pendingImport=null},title={Text("替换原生候选版账本？")},text={Text("不会修改旧版应用数据。请先导出当前账本备份。")},confirmButton={TextButton(onClick={model.command(json("action" to "import","value" to pendingImport));pendingImport=null}){Text("确认替换")}},dismissButton={TextButton(onClick={pendingImport=null}){Text("取消")}})
    if(restoreImport) AlertDialog(onDismissRequest={restoreImport=false},title={Text("恢复导入前账本？")},text={Text("当前账本会保留为新的撤销副本。")},confirmButton={TextButton(onClick={model.command(json("action" to "restoreImportBackup"));restoreImport=false}){Text("恢复")}},dismissButton={TextButton(onClick={restoreImport=false}){Text("取消")}})
}
