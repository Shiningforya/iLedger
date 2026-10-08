import SwiftUI
import Charts

@main struct ILedgerApp: App {
    @StateObject private var model = LedgerModel()
    var body: some Scene {
        WindowGroup("iLedger Native") {
            RootView().environmentObject(model)
                .frame(minWidth: 700, minHeight: 500)
                .task { await model.refresh() }
        }
        .defaultSize(width: 1080, height: 760)
        .commands {
            CommandGroup(after: .newItem) {
                Button("新增支出") { model.newTransaction() }.keyboardShortcut("n")
                Button("新增收入") { model.newTransaction("income") }.keyboardShortcut("n", modifiers: [.command, .shift])
                Divider()
                Button("导入账本…") { model.importFile() }
                Button("导出账本…") { model.exportFile() }.keyboardShortcut("e", modifiers: [.command, .shift])
            }
        }
        Settings { NativeSettingsView().environmentObject(model).frame(width: 590, height: 580) }
    }
}

struct RootView: View {
    @EnvironmentObject var model: LedgerModel
    private let sections: [(String, String, String)] = [
        ("dashboard", "驾驶舱", "chart.bar.xaxis"), ("transactions", "全部流水", "list.bullet.rectangle"),
        ("expense", "支出", "arrow.up.right"), ("income", "收入", "arrow.down.left"),
        ("loans", "借款", "arrow.left.arrow.right"), ("subscriptions", "订阅", "repeat"),
        ("assets", "资产折旧", "desktopcomputer"), ("accounts", "账户与信用", "creditcard"),
        ("categories", "类别管理", "tag"), ("rates", "币种与汇率", "dollarsign.arrow.circlepath"),
        ("projectRules", "项目记忆", "text.magnifyingglass")]
    var body: some View {
        NavigationSplitView {
            List(selection: $model.section) {
                ForEach(sections, id: \.0) { item in Label(item.1, systemImage: item.2).tag(item.0) }
            }
            .navigationTitle("iLedger")
            .navigationSplitViewColumnWidth(min: 175, ideal: 205)
        } detail: {
            Group {
                if model.section == "dashboard" { DashboardView() }
                else if model.section == "accounts" { AccountsView() }
                else { RecordsView(collection: model.section) }
            }
            .navigationTitle(sections.first { $0.0 == model.section }?.1 ?? "iLedger")
            .toolbar {
                ToolbarItemGroup {
                    if model.busy { ProgressView().controlSize(.small) }
                    Button { model.editor = EditorRoute(kind: "recognition") } label: { Label("文字与语音记账", systemImage: "waveform") }
                    Button { model.newTransaction() } label: { Label("新增支出", systemImage: "plus") }
                    SettingsLink { Label("设置", systemImage: "gearshape") }
                }
            }
        }
        .sheet(item: $model.editor) { route in
            if route.kind == "recognition" { RecognitionView().environmentObject(model) }
            else { RecordEditor(route: route).environmentObject(model) }
        }
        .alert("未能完成操作", isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })) { Button("好") { model.error = nil } } message: { Text(model.error ?? "") }
        .confirmationDialog("替换原生候选版的账本？", isPresented: Binding(get: { model.pendingImport != nil }, set: { if !$0 { model.pendingImport = nil } })) {
            Button("导入并替换", role: .destructive) {
                guard let value = model.pendingImport else { return }
                Task { _ = await model.command(["action": "import", "value": value]); model.pendingImport = nil }
            }
        } message: { Text("仅修改候选版账本，不会改动原来的 iLedger 应用数据。替换前请先导出备份。") }
    }
}

struct DashboardView: View {
    @EnvironmentObject var model: LedgerModel
    @State private var compact = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                HStack {
                    Text("每一笔，都有来处。").font(.largeTitle.bold())
                    Spacer()
                    Button { compact.toggle() } label: { Label("切换磁贴密度", systemImage: compact ? "rectangle.grid.2x2" : "square.grid.3x3") }.labelStyle(.iconOnly)
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: compact ? 150 : 210))], spacing: 12) {
                    metric("总收入", "income", .green); metric("总支出", "expense", .red); metric("收支差", "net", .primary)
                }
                Text("年度趋势").font(.headline)
                Chart {
                    ForEach(model.summary.rows("months"), id: \.monthIndex) { month in
                        BarMark(x: .value("月份", Int(month.number("month"))), y: .value("金额", month.number("income"))).foregroundStyle(by: .value("类型", "收入"))
                        BarMark(x: .value("月份", Int(month.number("month"))), y: .value("金额", -month.number("expense"))).foregroundStyle(by: .value("类型", "支出"))
                    }
                    RuleMark(y: .value("零", 0)).foregroundStyle(.secondary)
                }
                .chartXScale(domain: 0.5...12.5)
                .chartXAxis { AxisMarks(values: Array(1...12)) { value in AxisValueLabel { if let month = value.as(Int.self) { Text("\(month)月") } }; AxisGridLine() } }
                .chartForegroundStyleScale(["收入": Color.green, "支出": Color.red])
                .frame(height: compact ? 230 : 320)
                HStack { Text("最近流水").font(.headline); Spacer(); Button("查看全部") { model.section = "transactions" } }
                if model.state.rows("transactions").isEmpty {
                    ContentUnavailableView("尚无流水", systemImage: "tray", description: Text("新增一笔收入或支出"))
                } else {
                    ForEach(Array(model.state.rows("transactions").sorted { $0.text("date") > $1.text("date") }.prefix(compact ? 5 : 10)), id: \.recordID) { row in TransactionRow(row: row) }
                }
            }.padding(24)
        }
    }
    func metric(_ title: String, _ key: String, _ tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).foregroundStyle(.secondary)
            Text(model.money(model.summary.number(key))).font(.title2.bold()).foregroundStyle(tint).minimumScaleFactor(0.7).lineLimit(1)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(18).background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
    }
}

struct TransactionRow: View {
    @EnvironmentObject var model: LedgerModel
    let row: Record
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: row.text("type") == "income" ? "arrow.down.left" : "arrow.up.right").foregroundStyle(row.text("type") == "income" ? .green : .red)
            VStack(alignment: .leading, spacing: 4) {
                Text(row.text("item")).font(.headline)
                Text("\(row.text("date")) · \(row.text("category")) · \(model.name(row.text("accountId")))").font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 4) {
                Text(model.money(row.number("amount"), row.text("currency"))).monospacedDigit()
                if row.text("currency") != row.text("bookedBaseCurrency") { Text(model.money(row.number("amountInBase"), row.text("bookedBaseCurrency"))).font(.caption).foregroundStyle(.secondary) }
            }
            Button { model.editor = EditorRoute(kind: "transactions", value: row) } label: { Image(systemName: "pencil") }.help("编辑流水")
        }.padding(.vertical, 8)
    }
}

struct RecordsView: View {
    @EnvironmentObject var model: LedgerModel
    let collection: String
    @State private var page = 1
    @State private var search = ""
    @State private var deleting: Record?
    var isTransactions: Bool { ["transactions", "income", "expense"].contains(collection) }
    var rows: [Record] {
        model.state.rows(isTransactions ? "transactions" : collection).filter { row in
            (collection != "expense" && collection != "income" || row.text("type") == collection) &&
            (search.isEmpty || String(describing: row).localizedCaseInsensitiveContains(search))
        }.sorted { $0.text("date", $0.text("name", $0.text("code"))) > $1.text("date", $1.text("name", $1.text("code"))) }
    }
    var count: Int { max(1, (rows.count + 19) / 20) }
    var visible: [Record] { Array(rows.dropFirst((min(page, count) - 1) * 20).prefix(20)) }
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                TextField("搜索", text: $search).textFieldStyle(.roundedBorder).frame(maxWidth: 300)
                Spacer()
                Text("\(rows.count) 条").foregroundStyle(.secondary)
                if ["categories", "rates", "projectRules"].contains(collection) { Button { model.editor = EditorRoute(kind: collection) } label: { Label("新增", systemImage: "plus") } }
            }.padding()
            List {
                ForEach(visible, id: \.recordID) { row in
                    HStack {
                        if isTransactions { TransactionRow(row: row) }
                        else {
                            VStack(alignment: .leading, spacing: 5) {
                                Text(row.text("name", row.text("item"))).font(.headline)
                                Text(details(row)).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button { model.editor = EditorRoute(kind: collection, value: row) } label: { Image(systemName: "pencil") }.help("编辑")
                        }
                        if collection != "loans" {
                            Button(role: .destructive) { deleting = row } label: { Image(systemName: "trash") }.help("删除")
                        }
                    }.padding(.vertical, 5)
                }
                if rows.isEmpty { ContentUnavailableView("暂无记录", systemImage: "tray") }
            }
            HStack {
                Button { page = max(1, page - 1) } label: { Image(systemName: "chevron.left") }.disabled(page <= 1).help("上一页")
                Text("\(min(page, count)) / \(count)").monospacedDigit()
                Button { page = min(count, page + 1) } label: { Image(systemName: "chevron.right") }.disabled(page >= count).help("下一页")
            }.padding(12)
        }
        .onChange(of: collection) { _, _ in page = 1 }
        .onChange(of: search) { _, _ in page = 1 }
        .confirmationDialog("删除这条记录？", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })) {
            Button("删除", role: .destructive) { guard let row = deleting else { return }; Task {
                _ = await model.command(isTransactions ? ["action": "deleteTransaction", "id": row.text("id")] : ["action": "deleteEntity", "collection": collection, "id": row.text("id", row.text("code"))]); deleting = nil
            } }
        }
    }
    func details(_ row: Record) -> String {
        switch collection {
        case "rates": return "\(row.text("code")) · 1 = \(row.number("rateToCny")) CNY"
        case "categories": return row.text("type") == "income" ? "收入" : "支出"
        case "subscriptions": return "\(model.money(row.number("amount"), row.text("bookedBaseCurrency"))) · \(row.text("endsAt"))"
        case "assets": return "\(model.money(row.number("price"), row.text("bookedBaseCurrency"))) · \(Int(row.number("lifeDays"))) 天"
        case "loans": return "\(model.money(row.number("principal"), row.text("currency"))) · \(row.text("status") == "repaid" ? "已归还" : "待还款")"
        default: return row.text("keyword")
        }
    }
}

struct AccountsView: View {
    @EnvironmentObject var model: LedgerModel
    var body: some View {
        List {
            ForEach(model.state.rows("accounts").filter { $0.text("parentAccountId").isEmpty }, id: \.recordID) { parent in
                Section {
                    ForEach(model.children.filter { $0.text("parentAccountId") == parent.text("id") }, id: \.recordID) { child in
                        HStack {
                            Label(child.text("name"), systemImage: "creditcard")
                            Spacer()
                            Text(model.money(child.number("balance"), child.text("currency"))).monospacedDigit()
                            Button { model.editor = EditorRoute(kind: "accounts", value: child) } label: { Image(systemName: "pencil") }.help("编辑子账户")
                        }.padding(.vertical, 8)
                    }
                } header: {
                    HStack {
                        Text(parent.text("name"))
                        Spacer()
                        Button { model.editor = EditorRoute(kind: "accounts", value: parent) } label: { Image(systemName: "pencil") }.help("编辑主账户")
                        Button { model.editor = EditorRoute(kind: "accounts", value: ["parentAccountId": parent.text("id")]) } label: { Image(systemName: "plus") }.help("新增子账户")
                    }
                }
            }
            if model.state.rows("accounts").isEmpty { ContentUnavailableView("尚无账户", systemImage: "creditcard", description: Text("添加账户后即可记账")) }
        }
        .toolbar { Button { model.editor = EditorRoute(kind: "accounts") } label: { Label("添加账户", systemImage: "plus.rectangle.on.rectangle") } }
    }
}
