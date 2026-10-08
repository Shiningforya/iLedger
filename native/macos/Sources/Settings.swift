import SwiftUI
import Security

enum KeychainVault {
    static let service = "com.iledger.native.webdav"
    static func store(_ data: Data) throws {
        let query: [String: Any] = [kSecClass as String:kSecClassGenericPassword, kSecAttrService as String:service, kSecAttrAccount as String:"session"]
        let updated = SecItemUpdate(query as CFDictionary, [kSecValueData as String:data] as CFDictionary)
        if updated == errSecItemNotFound {
            var entry = query; entry[kSecValueData as String] = data; entry[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            let status = SecItemAdd(entry as CFDictionary, nil)
            guard status == errSecSuccess else { throw LedgerFailure(message:"钥匙串保存失败（\(status)）") }; return
        }
        guard updated == errSecSuccess else { throw LedgerFailure(message:"钥匙串更新失败（\(updated)）") }
    }
    static func read() -> Data? {
        var result: CFTypeRef?
        let query: [String:Any] = [kSecClass as String:kSecClassGenericPassword, kSecAttrService as String:service, kSecAttrAccount as String:"session", kSecReturnData as String:true]
        return SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess ? result as? Data : nil
    }
    static func remove() { SecItemDelete([kSecClass as String:kSecClassGenericPassword, kSecAttrService as String:service] as CFDictionary) }
}

struct CloudIdentity: Codable { var endpoint: String; var username: String; var password: String }
final class NoRedirectDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
enum NativeWebDAV {
    static func request(_ identity: CloudIdentity, method: String, body: Data? = nil, etag: String? = nil) async throws -> (Data, HTTPURLResponse) {
        guard let url = URL(string: identity.endpoint), url.scheme == "https", url.host != nil, url.user == nil, url.password == nil else { throw LedgerFailure(message: "请填写 HTTPS WebDAV 文件地址") }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 30; configuration.timeoutIntervalForResource = 120
        let session = URLSession(configuration: configuration, delegate: NoRedirectDelegate(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        var request = URLRequest(url: url); request.httpMethod = method; request.httpBody = body
        request.setValue("Basic " + Data("\(identity.username):\(identity.password)".utf8).base64EncodedString(), forHTTPHeaderField: "Authorization")
        if method == "PUT" { request.setValue("application/json", forHTTPHeaderField: "Content-Type"); request.setValue(etag ?? "*", forHTTPHeaderField: etag == nil ? "If-None-Match" : "If-Match") }
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw LedgerFailure(message:"服务器响应无效") }
        guard (200...299).contains(response.statusCode) || (method == "HEAD" && response.statusCode == 404) else {
            throw LedgerFailure(message: response.statusCode == 412 ? "云端文件已变更，请先检查云端，避免覆盖其他设备的修改。" : "WebDAV 返回 HTTP \(response.statusCode)")
        }
        return (data, response)
    }
}

struct NativeSettingsView: View {
    @EnvironmentObject var model: LedgerModel
    @State private var identity = CloudIdentity(endpoint: "https://dav.jianguoyun.com/dav/iLedger/ledger-native-candidate.json", username: "", password: "")
    @State private var loggedIn = false
    @State private var status = ""
    @State private var working = false
    @State private var etag: String?
    @State private var checked = false
    @State private var cloudImport: Record?
    @State private var restoreImport = false
    var body: some View {
        TabView {
            Form {
                Section("记账") {
                    Picker("后续记账的本币", selection: Binding(get: { model.base }, set: { code in Task { _ = await model.command(["action":"settings", "value":["baseCurrency":code]]) } })) { ForEach(model.state.rows("rates"), id: \.recordID) { Text("\($0.text("code")) · \($0.text("name"))").tag($0.text("code")) } }
                    LabeledContent("版本", value: "\(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "") (\(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""))")
                }
                Section("账本文件") {
                    Button("导入 JSON 账本…") { model.importFile() }
                    Button("导出 JSON 备份…") { model.exportFile() }
                    Button("撤销上次导入…") { restoreImport = true }
                }
            }.formStyle(.grouped).tabItem { Label("通用", systemImage:"gearshape") }
            Form {
                TextField("WebDAV 文件地址", text: $identity.endpoint).disabled(loggedIn)
                TextField("账号", text: $identity.username).disabled(loggedIn)
                if !loggedIn { SecureField("应用密码", text: $identity.password) }
                HStack {
                    if loggedIn { Label("已登录", systemImage:"checkmark.circle.fill").foregroundStyle(.green); Spacer(); Button("注销") { KeychainVault.remove(); identity.password = ""; loggedIn = false; checked = false; etag = nil; status = "已注销" } }
                    else { Button("登录") { Task { await login() } }.disabled(working || identity.password.isEmpty || identity.username.isEmpty) }
                }
                if loggedIn {
                    HStack {
                        Button("检查云端") { Task { await check() } }
                        Button("上传本地") { Task { await upload() } }.disabled(!checked)
                        Button("下载云端") { Task { await download() } }
                    }.disabled(working)
                }
                if working { ProgressView() }
                if !status.isEmpty { Text(status).foregroundStyle(.secondary).textSelection(.enabled) }
            }.formStyle(.grouped).tabItem { Label("坚果云", systemImage:"cloud") }
            ModelSettingsView().tabItem { Label("本地模型", systemImage:"cpu") }
        }.padding(12)
        .onAppear { if let data = KeychainVault.read(), let saved = try? JSONDecoder().decode(CloudIdentity.self, from: data) { identity = saved; loggedIn = true; status = "账号已保存在系统钥匙串" } }
        .confirmationDialog("使用云端账本替换候选版本地账本？", isPresented: Binding(get: { cloudImport != nil }, set: { if !$0 { cloudImport = nil } })) {
            Button("确认替换", role:.destructive) { if let value = cloudImport { Task { if await model.command(["action":"import", "value":value]) { status = "云端账本已导入" }; cloudImport = nil } } }
        }
        .confirmationDialog("恢复上次导入前的账本？", isPresented:$restoreImport) {
            Button("恢复导入前账本", role:.destructive) { Task { _ = await model.command(["action":"restoreImportBackup"]) } }
        } message: { Text("当前账本会保留为新的撤销副本。") }
    }
    func login() async {
        working = true; defer { working = false }
        do { let (_, response) = try await NativeWebDAV.request(identity, method:"HEAD"); try KeychainVault.store(JSONEncoder().encode(identity)); loggedIn = true; etag = response.value(forHTTPHeaderField:"ETag"); checked = response.statusCode == 404 || etag != nil; status = "登录成功。账号将保持登录，直到注销。" }
        catch { status = error.localizedDescription }
    }
    func check() async {
        working = true; defer { working = false }
        do { let (_, response) = try await NativeWebDAV.request(identity, method:"HEAD"); etag = response.value(forHTTPHeaderField:"ETag"); checked = response.statusCode == 404 || etag != nil; status = response.statusCode == 404 ? "云端文件尚不存在，可上传本地账本。" : checked ? "云端文件可用。上传将替换该版本；下载前会再次确认。" : "服务器未提供 ETag，已禁用覆盖上传以保护云端数据。" }
        catch { status = error.localizedDescription; checked = false }
    }
    func upload() async {
        working = true; defer { working = false }
        do { let data = try JSONSerialization.data(withJSONObject:model.state); _ = try await NativeWebDAV.request(identity, method:"PUT", body:data, etag:etag); checked = false; status = "上传完成。再次上传前请重新检查云端。" }
        catch { status = error.localizedDescription }
    }
    func download() async {
        working = true; defer { working = false }
        do { let (data, _) = try await NativeWebDAV.request(identity, method:"GET"); guard data.count < 100 * 1024 * 1024, let json = try JSONSerialization.jsonObject(with:data) as? Record else { throw LedgerFailure(message:"云端账本格式无效或过大") }; cloudImport = json["state"] as? Record ?? json }
        catch { status = error.localizedDescription }
    }
}
