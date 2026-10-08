package com.iledger.nativeapp

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import org.json.JSONArray
import org.json.JSONObject
import java.text.NumberFormat
import java.time.LocalDate
import java.util.Currency
import kotlin.math.abs
import kotlin.math.max

class MainActivity: ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MaterialTheme(colorScheme=if(isSystemInDarkTheme()) darkColorScheme() else lightColorScheme(primary=Color(0xFF347760))) { LedgerApp() }
        }
    }
}
fun money(amount: Double, code: String): String = runCatching { NumberFormat.getCurrencyInstance().apply { currency=Currency.getInstance(code) }.format(amount) }.getOrDefault("$code $amount")
val sections = listOf("transactions" to "全部流水", "expense" to "支出", "income" to "收入", "loans" to "借款", "subscriptions" to "订阅", "assets" to "资产折旧", "accounts" to "账户", "categories" to "类别", "rates" to "币种")

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun LedgerApp(model: LedgerModel = viewModel()) {
    val ui by model.ui.collectAsStateWithLifecycle()
    val section by model.section.collectAsStateWithLifecycle()
    val routes by model.routes.collectAsStateWithLifecycle()
    val title = sections.firstOrNull { it.first == section }?.second ?: if(section=="settings") "设置" else "驾驶舱"
    val state = ui.state
    BackHandler(enabled=routes.isEmpty() && section!="dashboard") { model.select("dashboard") }
    Scaffold(
        topBar={ TopAppBar(title={ Text(title) }, actions={
            IconButton(onClick={model.push("recognition")}) { Icon(Icons.Default.EditNote,"文字记账") }
            IconButton(onClick={model.push("transactions",json("type" to "expense", "currency" to state.optString("baseCurrency","CNY"), "date" to LocalDate.now().toString()))}) { Icon(Icons.Default.Add,"新增支出") }
            IconButton(onClick={model.select("settings")}) { Icon(Icons.Default.Settings,"设置") }
        }) },
        bottomBar={ NavigationBar {
            listOf(Triple("dashboard","驾驶舱",Icons.Default.Dashboard),Triple("transactions","数据库",Icons.Default.Storage),Triple("accounts","我的",Icons.Default.Person)).forEach { (key,label,icon) ->
                val selected=if(key=="transactions") section in listOf("transactions","expense","income","loans","subscriptions","assets") else if(key=="accounts") section in listOf("accounts","categories","rates") else section==key
                NavigationBarItem(selected=selected,onClick={model.select(key)},icon={Icon(icon,label)},label={Text(label)},modifier=Modifier.testTag("nav-$key"))
            }
        } }
    ) { insets ->
        Column(Modifier.padding(insets).consumeWindowInsets(insets).fillMaxSize()) {
            if(ui.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            when(section) {
                "dashboard" -> Dashboard(state,ui.summary)
                "settings" -> SettingsScreen(model,state)
                else -> {
                    val choices=if(section in listOf("accounts","categories","rates")) sections.takeLast(3) else sections.take(6)
                    ScrollableTabRow(selectedTabIndex=choices.indexOfFirst { it.first==section }.coerceAtLeast(0),edgePadding=8.dp) {
                        choices.forEach { (key,label) -> Tab(selected=key==section,onClick={model.select(key)},text={Text(label)}) }
                    }
                    RecordList(model,section,state)
                }
            }
        }
    }
    routes.forEachIndexed { index, encoded ->
        key(encoded,index) { EditorDialog(model,JSONObject(encoded),state) }
    }
    if(ui.error != null) AlertDialog(onDismissRequest=model::clearError,title={Text("未能完成操作")},text={Text(ui.error ?: "")},confirmButton={TextButton(onClick=model::clearError){Text("好")}})
}

@Composable private fun Dashboard(state: JSONObject, summary: JSONObject) {
    val configuration=LocalConfiguration.current
    val columns=if(configuration.screenWidthDp >= 340 && configuration.fontScale <= 1.5f) 2 else 1
    val rows=remember(state) { state.rows("transactions").sortedByDescending { it.optString("date") } }
    val base=state.optString("baseCurrency","CNY")
    LazyVerticalGrid(columns=GridCells.Fixed(columns),contentPadding=PaddingValues(12.dp),horizontalArrangement=Arrangement.spacedBy(12.dp),verticalArrangement=Arrangement.spacedBy(12.dp),modifier=Modifier.testTag("dashboard-grid")) {
        items(listOf("income" to "总收入","expense" to "总支出","net" to "收支差"),key={it.first}) { (key,label) ->
            OutlinedCard(Modifier.fillMaxWidth().heightIn(min=108.dp)) { Column(Modifier.padding(14.dp),verticalArrangement=Arrangement.spacedBy(10.dp)) {
                Text(label,style=MaterialTheme.typography.labelLarge)
                Text(money(summary.optDouble(key,0.0),base),style=MaterialTheme.typography.titleLarge)
            } }
        }
        item(span={GridItemSpan(maxLineSpan)}) { Text("年度趋势 · 1–12 月",style=MaterialTheme.typography.titleMedium,modifier=Modifier.padding(top=12.dp)) }
        item(span={GridItemSpan(maxLineSpan)}) {
            val months=summary.rows("months");val maxValue=max(1.0,months.maxOfOrNull { max(it.optDouble("income"),it.optDouble("expense")) } ?: 1.0)
            Column {
                Canvas(Modifier.fillMaxWidth().height(210.dp)) {
                    val zero=size.height/2; val step=size.width/12
                    drawLine(Color.Gray,Offset(0f,zero),Offset(size.width,zero),1.dp.toPx())
                    months.forEachIndexed { index,month ->
                        val x=(index+.5f)*step
                        drawLine(Color(0xFF388C6C),Offset(x,zero),Offset(x,zero-(month.optDouble("income")/maxValue*zero*.9).toFloat()),step*.3f)
                        drawLine(Color(0xFFD06565),Offset(x,zero),Offset(x,zero+(month.optDouble("expense")/maxValue*zero*.9).toFloat()),step*.3f)
                    }
                }
                Row(Modifier.fillMaxWidth()) { (1..12).forEach { Text("$it",Modifier.weight(1f),style=MaterialTheme.typography.labelSmall) } }
            }
        }
        item(span={GridItemSpan(maxLineSpan)}) { Text("最近流水",style=MaterialTheme.typography.titleMedium,modifier=Modifier.padding(top=12.dp)) }
        items(rows.take(20),key={it.optString("id")},span={GridItemSpan(maxLineSpan)}) { row -> RecordContent(row,"transactions",state) }
        if(rows.isEmpty()) item(span={GridItemSpan(maxLineSpan)}) { Text("尚无流水",modifier=Modifier.padding(24.dp)) }
    }
}

@Composable private fun RecordList(model: LedgerModel, section: String, state: JSONObject) {
    var page by rememberSaveable(section) { mutableIntStateOf(1) }
    var search by rememberSaveable(section) { mutableStateOf("") }
    var deleting by remember { mutableStateOf<JSONObject?>(null) }
    val transactions=section in listOf("transactions","expense","income")
    val collection=if(transactions) "transactions" else section
    val rows=remember(state,section,search) { state.rows(collection).filter { (section !in listOf("expense","income") || it.optString("type")==section) && (search.isBlank() || it.toString().contains(search,true)) }.sortedByDescending { it.optString("date") } }
    val pages=max(1,(rows.size+19)/20);val actualPage=page.coerceAtMost(pages)
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal=12.dp),verticalAlignment=Alignment.CenterVertically) {
            OutlinedTextField(search,{search=it;page=1},label={Text("搜索")},singleLine=true,modifier=Modifier.weight(1f))
            if(section in listOf("accounts","categories","rates")) IconButton(onClick={model.push(section)}){Icon(Icons.Default.Add,"新增")}
        }
        LazyColumn(Modifier.weight(1f),contentPadding=PaddingValues(12.dp)) {
            items(rows.drop((actualPage-1)*20).take(20),key={it.optString("id",it.optString("code"))}) { row ->
                Column {
                    Row(verticalAlignment=Alignment.CenterVertically) {
                        Box(Modifier.weight(1f)) { RecordContent(row,collection,state) }
                        IconButton(onClick={model.push(collection,row)}) { Icon(Icons.Default.Edit,"编辑") }
                        if(collection!="accounts" && collection!="loans") IconButton(onClick={deleting=row}) { Icon(Icons.Default.Delete,"删除") }
                        if(collection=="accounts" && row.optString("parentAccountId").isEmpty()) IconButton(onClick={model.push("accounts",json("parentAccountId" to row.optString("id")))}) { Icon(Icons.Default.Add,"新增子账户") }
                    }; HorizontalDivider()
                }
            }
            if(rows.isEmpty()) item { Text("暂无记录",Modifier.padding(24.dp)) }
        }
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.Center,verticalAlignment=Alignment.CenterVertically) {
            IconButton(onClick={page=max(1,page-1)},enabled=actualPage>1) { Icon(Icons.AutoMirrored.Filled.ArrowBack,"上一页") }
            Text("$actualPage / $pages · ${rows.size} 条")
            IconButton(onClick={page=(page+1).coerceAtMost(pages)},enabled=actualPage<pages) { Icon(Icons.Default.ArrowForward,"下一页") }
        }
    }
    deleting?.let { row -> AlertDialog(onDismissRequest={deleting=null},title={Text("删除记录？")},confirmButton={TextButton(onClick={
        model.command(if(transactions) json("action" to "deleteTransaction","id" to row.optString("id")) else json("action" to "deleteEntity","collection" to collection,"id" to row.optString("id",row.optString("code"))))
        deleting=null
    }){Text("删除")}},dismissButton={TextButton(onClick={deleting=null}){Text("取消")}}) }
}

@Composable private fun RecordContent(row: JSONObject, kind: String, state: JSONObject) {
    val base=state.optString("baseCurrency","CNY")
    Column(Modifier.fillMaxWidth().padding(vertical=12.dp),verticalArrangement=Arrangement.spacedBy(4.dp)) {
        Text(row.optString(if(kind=="transactions") "item" else "name"),style=MaterialTheme.typography.titleMedium)
        if(kind=="transactions") {
            Text(money(row.optDouble("amount"),row.optString("currency",base)),style=MaterialTheme.typography.titleSmall)
            val account=state.rows("accounts").firstOrNull { it.optString("id")==row.optString("accountId") }
            Text("${row.optString("date")} · ${row.optString("category")} · ${account?.optString("name") ?: ""}",style=MaterialTheme.typography.bodySmall)
            if(row.optString("currency")!=row.optString("bookedBaseCurrency")) Text(money(row.optDouble("amountInBase"),row.optString("bookedBaseCurrency",base)),style=MaterialTheme.typography.bodySmall)
        } else when(kind) {
            "accounts" -> if(row.optString("parentAccountId").isNotEmpty()) Text(money(row.optDouble("balance",0.0),row.optString("currency",base))) else Text("主账户",style=MaterialTheme.typography.bodySmall)
            "rates" -> Text("${row.optString("code")} · ${row.optDouble("rateToCny")} CNY")
            "subscriptions" -> Text("${money(row.optDouble("amount"),row.optString("bookedBaseCurrency",base))} · ${row.optString("endsAt")}")
            "assets" -> Text("${money(row.optDouble("price"),row.optString("bookedBaseCurrency",base))} · ${row.optInt("lifeDays")} 天")
            "loans" -> Text("${money(row.optDouble("principal"),row.optString("currency",base))} · ${if(row.optString("status")=="repaid") "已归还" else "待还款"}")
        }
    }
}
