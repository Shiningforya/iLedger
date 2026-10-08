import SwiftUI

struct RecordEditor: View {
    @EnvironmentObject var model: LedgerModel
    @Environment(\.dismiss) private var dismiss
    let route: EditorRoute
    @State private var fields: [String: String] = [:]
    @State private var subscription = false
    @State private var asset = false
    @State private var credit = false
    @State private var nested: EditorRoute?
    @State private var confirmDelete = false
    @State private var transferTarget = ""
    var isNew: Bool { route.value.text("id", route.value.text("code")).isEmpty }
    var title: String { (isNew ? "新增" : "编辑") + (["transactions":"流水", "accounts":"账户", "categories":"类别", "rates":"币种", "subscriptions":"订阅", "assets":"折旧资产", "loans":"借款", "projectRules":"项目记忆"][route.kind] ?? "记录") }
    func binding(_ key: String) -> Binding<String> { Binding(get: { fields[key] ?? "" }, set: { fields[key] = $0 }) }
    var body: some View {
        VStack(spacing: 0) {
            HStack { Text(title).font(.title2.bold()); Spacer(); Button { dismiss() } label: { Image(systemName: "xmark") }.keyboardShortcut(.cancelAction).help("关闭") }.padding()
            Form {
                switch route.kind {
                case "transactions": transactionFields
                case "accounts": accountFields
                case "categories":
                    TextField("类别名称", text: binding("name")); typePicker; aliases
                case "rates":
                    TextField("币种代码", text: binding("code")).disabled(!isNew)
                    TextField("币种名称", text: binding("name"))
                    TextField("1 单位兑换 CNY", text: binding("rateToCny")); aliases
                case "projectRules":
                    TextField("关键词", text: binding("keyword")); TextField("项目名称", text: binding("item")); aliases
                case "subscriptions":
                    TextField("名称", text: binding("name")); TextField("金额", text: binding("amount"))
                    TextField("开始日期", text: binding("startedAt")); TextField("到期日期", text: binding("endsAt"))
                    cyclePicker; renewalPicker
                case "assets":
                    TextField("名称", text: binding("name")); TextField("原价", text: binding("price"))
                    TextField("购入日期", text: binding("purchasedAt")); TextField("折旧天数", text: binding("lifeDays"))
                case "loans":
                    TextField("名称", text: binding("name")); TextField("本金", text: binding("principal"))
                    TextField("借入日期", text: binding("borrowedAt")); TextField("约定归还日", text: binding("dueDate"))
                    if route.value.text("status") != "repaid" {
                        Button("归还借款…") {
                            let row = route.value
                            nested = EditorRoute(kind: "transactions", value: ["item": "归还\(row.text("borrowedAt"))的\(row.number("principal"))借款", "amount": row.number("principal"), "currency": row.text("currency"), "date": LedgerModel.today, "type": "expense", "category": "归还借款", "repaymentLoanId": row.text("id")])
                        }
                    }
                default: EmptyView()
                }
            }.formStyle(.grouped)
            Divider()
            HStack {
                if route.kind == "accounts" && !isNew { Button("删除账户…", role: .destructive) { confirmDelete = true } }
                Spacer()
                Button("取消") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("保存") { Task { await save() } }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(model.busy)
            }.padding()
        }
        .frame(width: 540, height: route.kind == "transactions" || route.kind == "accounts" ? 640 : 440)
        .onAppear(perform: initialize)
        .sheet(item: $nested) { RecordEditor(route: $0).environmentObject(model) }
        .sheet(isPresented: $confirmDelete) {
            VStack(alignment: .leading, spacing: 18) {
                Text("删除账户").font(.headline)
                if !route.value.text("parentAccountId").isEmpty {
                    Picker("将余额与流水转移至", selection: $transferTarget) {
                        Text("请选择").tag("")
                        ForEach(model.children.filter { $0.text("id") != route.value.text("id") && $0.text("currency") == route.value.text("currency") }, id: \.recordID) { Text($0.text("name")).tag($0.text("id")) }
                    }
                } else { Text("主账户内仍有子账户时无法删除。") }
                HStack { Button("取消") { confirmDelete = false }; Spacer(); Button("确认删除", role: .destructive) { Task {
                    if await model.command(["action":"deleteAccount", "id":route.value.text("id"), "targetAccountId":transferTarget]) { confirmDelete = false; dismiss() }
                } } }
            }.padding(24).frame(width: 420)
        }
    }
    var aliases: some View { TextField("识别库关键词（逗号分隔）", text: binding("aliases")) }
    var typePicker: some View { Picker("类型", selection: binding("type")) { Text("支出").tag("expense"); Text("收入").tag("income") } }
    var currencyPicker: some View {
        Picker("币种", selection: binding("currency")) { ForEach(model.state.rows("rates"), id: \.recordID) { Text("\($0.text("code")) · \($0.text("name"))").tag($0.text("code")) } }
    }
    var cyclePicker: some View { Picker("周期", selection: binding("cycle")) { Text("每月").tag("monthly"); Text("每年").tag("yearly"); Text("每周").tag("weekly") } }
    var renewalPicker: some View { Picker("续订方式", selection: binding("renewalMode")) { Text("固定期限").tag("fixed"); Text("自动续订").tag("auto") } }
    var transactionFields: some View {
        Group {
            typePicker
            TextField("项目名称", text: binding("item"))
            TextField("金额", text: binding("amount")); currencyPicker
            if fields["currency"] != (route.value.text("bookedBaseCurrency", model.base)) {
                TextField("汇率 → \(route.value.text("bookedBaseCurrency", model.base))", text: binding("exchangeRateToBase"))
            }
            HStack {
                Picker("类别", selection: binding("category")) { ForEach(model.state.rows("categories").filter { $0.text("type") == fields["type"] }, id: \.recordID) { Text($0.text("name")).tag($0.text("name")) } }
                Button { nested = EditorRoute(kind: "categories", value: ["type": fields["type"] ?? "expense"]) } label: { Image(systemName: "plus.circle") }.help("新建类别")
            }
            Picker("主账户", selection: binding("parentAccountId")) {
                Text("请选择").tag("")
                ForEach(model.state.rows("accounts").filter { $0.text("parentAccountId").isEmpty }, id: \.recordID) { Text($0.text("name")).tag($0.text("id")) }
            }
            HStack {
                Picker("子账户", selection: binding("accountId")) {
                    Text("请选择").tag("")
                    ForEach(model.children.filter { $0.text("parentAccountId") == fields["parentAccountId"] }, id: \.recordID) { Text("\($0.text("name")) · \($0.text("currency"))").tag($0.text("id")) }
                }
                Button { nested = EditorRoute(kind: "accounts", value: ["parentAccountId": fields["parentAccountId"] ?? ""]) } label: { Image(systemName: "plus.circle") }.help("新建子账户")
            }
            TextField("日期（YYYY-MM-DD）", text: binding("date"))
            if fields["category"] == "借款" { TextField("约定还款日期", text: binding("loanDueDate")) }
            if fields["type"] == "expense" {
                Toggle("这是订阅项目", isOn: $subscription)
                if subscription { TextField("订阅到期日", text: binding("subscriptionEndsAt")); cyclePicker; renewalPicker }
                Toggle("加入资产折旧", isOn: $asset)
                if asset { TextField("折旧天数", text: binding("assetLifeDays")) }
            }
            TextField("备注", text: binding("note"), axis: .vertical)
        }
        .onChange(of: fields["currency"]) { old, next in
            if old != next { let target = route.value.text("bookedBaseCurrency", model.base); fields["exchangeRateToBase"] = String(rate(next ?? model.base) / rate(target)) }
        }
        .onChange(of: fields["parentAccountId"]) { _, next in
            if !model.children.contains(where: { $0.text("parentAccountId") == next && $0.text("id") == fields["accountId"] }) { fields["accountId"] = model.children.first { $0.text("parentAccountId") == next }?.text("id") ?? "" }
        }
        .onChange(of: fields["type"]) { _, next in if !model.state.rows("categories").contains(where: { $0.text("type") == next && $0.text("name") == fields["category"] }) { fields["category"] = model.state.rows("categories").first { $0.text("type") == next }?.text("name") ?? "" } }
    }
    var accountFields: some View {
        Group {
            TextField("账户名称", text: binding("name"))
            Picker("账户层级", selection: binding("parentAccountId")) {
                Text("主账户").tag("")
                ForEach(model.state.rows("accounts").filter { $0.text("parentAccountId").isEmpty && $0.text("id") != route.value.text("id") }, id: \.recordID) { Text("子账户 · \($0.text("name"))").tag($0.text("id")) }
            }.disabled(!isNew)
            if fields["parentAccountId", default: ""].isEmpty {
                if isNew { TextField("首个子账户名称", text: binding("childName")); currencyPicker; TextField("初始余额", text: binding("balance")) }
            } else {
                currencyPicker; TextField("余额", text: binding("balance")); aliases
                Toggle("信用账户", isOn: $credit)
                if credit { TextField("每月出账日", text: binding("statementDay")); TextField("每月还款日", text: binding("repaymentDay")) }
            }
        }
    }
    func rate(_ code: String) -> Double { model.state.rows("rates").first { $0.text("code") == code }?.number("rateToCny") ?? 1 }
    func initialize() {
        for (key, value) in route.value { if let text = value as? String { fields[key] = text } else if let number = value as? NSNumber { fields[key] = number.stringValue } }
        fields["aliases"] = (route.value["aliases"] as? [String] ?? []).joined(separator: ", ")
        fields["currency"] = fields["currency"] ?? model.base
        fields["type"] = fields["type"] ?? "expense"
        fields["date"] = fields["date"] ?? LedgerModel.today
        fields["cycle"] = fields["cycle"] ?? "monthly"; fields["renewalMode"] = fields["renewalMode"] ?? "fixed"
        fields["balance"] = fields["balance"] ?? "0"
        fields["assetLifeDays"] = fields["assetLifeDays"] ?? "1095"
        if route.kind == "transactions" {
            let account = model.children.first { $0.text("id") == fields["accountId"] } ?? model.children.first { $0.text("currency") == model.base }
            fields["accountId"] = account?.text("id") ?? ""; fields["parentAccountId"] = account?.text("parentAccountId") ?? ""
            fields["category"] = fields["category"] ?? model.state.rows("categories").first { $0.text("type") == fields["type"] }?.text("name") ?? ""
            fields["exchangeRateToBase"] = fields["exchangeRateToBase"] ?? String(rate(fields["currency"]!) / rate(route.value.text("bookedBaseCurrency", model.base)))
            if let sub = model.state.rows("subscriptions").first(where: { $0.text("id") == route.value.text("subscriptionId") }) { subscription = true; fields["subscriptionEndsAt"] = sub.text("endsAt"); fields["cycle"] = sub.text("cycle"); fields["renewalMode"] = sub.text("renewalMode") }
            if let item = model.state.rows("assets").first(where: { $0.text("id") == route.value.text("assetId") }) { asset = true; fields["assetLifeDays"] = String(Int(item.number("lifeDays"))) }
        }
        if let tool = model.state.rows("creditTools").first(where: { $0.text("accountId") == route.value.text("id") }) { credit = true; fields["statementDay"] = String(Int(tool.number("statementDay"))); fields["repaymentDay"] = String(Int(tool.number("repaymentDay"))) }
    }
    func save() async {
        var value = route.value
        for (key, text) in fields { value[key] = text }
        for key in ["amount", "balance", "rateToCny", "exchangeRateToBase", "assetLifeDays", "price", "principal", "lifeDays"] where fields[key] != nil {
            guard let number = Double(fields[key]!), number.isFinite else { model.error = "请输入有效的数字：\(key)"; return }; value[key] = number
        }
        value["aliases"] = (fields["aliases"] ?? "").components(separatedBy: CharacterSet(charactersIn: ",，")).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        var request: Record = ["value": value]
        switch route.kind {
        case "transactions":
            value["isSubscription"] = subscription; value["trackDepreciation"] = asset
            value["subscriptionCycle"] = fields["cycle"]; value["subscriptionMode"] = fields["renewalMode"]
            if let tool = model.state.rows("creditTools").first(where: { $0.text("accountId") == fields["accountId"] }) { value["paymentKind"] = fields["type"] == "income" ? "normal" : "credit"; value["creditToolId"] = tool.text("id") }
            else { value["paymentKind"] = "normal"; value.removeValue(forKey: "creditToolId") }
            request = ["action":"saveTransaction", "value": value]
        case "accounts":
            request["action"] = "saveAccount"
            if fields["parentAccountId", default: ""].isEmpty { request["initialChild"] = ["name":fields["childName"] ?? "", "currency":fields["currency"] ?? model.base, "balance":value.number("balance")] as Record }
            else { request["credit"] = credit ? ["statementDay":Double(fields["statementDay"] ?? "") ?? 0, "repaymentDay":Double(fields["repaymentDay"] ?? "") ?? 0] : NSNull() }
        case "categories": request["action"] = "saveCategory"
        case "rates": request["action"] = "saveRate"
        case "projectRules": request["action"] = "saveRule"
        default: request["action"] = "saveManaged"; request["collection"] = route.kind
        }
        if await model.command(request) { dismiss() }
    }
}
