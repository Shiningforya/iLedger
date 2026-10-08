import Foundation
import SwiftUI
import UniformTypeIdentifiers

typealias Record = [String: Any]
extension Dictionary where Key == String, Value == Any {
    var recordID: String { text("id", text("code")) }
    var monthIndex: Int { Int(number("month")) }
    func text(_ key: String, _ fallback: String = "") -> String { self[key] as? String ?? fallback }
    func number(_ key: String) -> Double { (self[key] as? NSNumber)?.doubleValue ?? 0 }
    func rows(_ key: String) -> [Record] { self[key] as? [Record] ?? [] }
}
struct LedgerFailure: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

final class NativeDatabase: @unchecked Sendable {
    private let queue = DispatchQueue(label: "com.iledger.database", qos: .userInitiated)
    private var handle: OpaquePointer?
    let directory: URL
    init() throws {
        let override = ProcessInfo.processInfo.environment["ILEDGER_DATA_DIR"]
        directory = override.map { URL(fileURLWithPath: $0) } ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("iLedger Native", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes:[.posixPermissions:0o700])
        guard let seedURL = Bundle.main.url(forResource: "presets", withExtension: "json") else { throw LedgerFailure(message: "缺少预设数据") }
        let seed = try String(contentsOf: seedURL, encoding: .utf8)
        handle = il_open(directory.appendingPathComponent("ledger.sqlite").path, seed)
        guard handle != nil else { throw LedgerFailure(message: String(cString: il_last_error())) }
    }
    deinit { il_close(handle) }
    func execute(_ request: Record) async throws -> Record {
        let data = try JSONSerialization.data(withJSONObject: request)
        return try await withCheckedThrowingContinuation { continuation in
            queue.async { [self] in
                do {
                    guard let response = il_execute(handle, String(decoding: data, as: UTF8.self)) else { throw LedgerFailure(message: "数据库内存不足") }
                    defer { il_free(response) }
                    let bytes = Data(String(cString: response).utf8)
                    guard let envelope = try JSONSerialization.jsonObject(with: bytes) as? Record else { throw LedgerFailure(message: "数据库响应无效") }
                    guard envelope["ok"] as? Bool == true else { throw LedgerFailure(message: envelope.text("error")) }
                    continuation.resume(returning: envelope["data"] as? Record ?? [:])
                } catch { continuation.resume(throwing: error) }
            }
        }
    }
}

struct EditorRoute: Identifiable {
    let id = UUID()
    let kind: String
    var value: Record = [:]
}

@MainActor final class LedgerModel: ObservableObject {
    @Published var state: Record = [:]
    @Published var summary: Record = [:]
    @Published var error: String?
    @Published var busy = false
    @Published var editor: EditorRoute?
    @Published var section = "dashboard"
    @Published var pendingImport: Record?
    @Published var search = ""
    let database: NativeDatabase?
    init() {
        do { database = try NativeDatabase() }
        catch { database = nil; self.error = error.localizedDescription }
    }
    var base: String { state.text("baseCurrency", "CNY") }
    var children: [Record] { state.rows("accounts").filter { !$0.text("parentAccountId").isEmpty } }
    func name(_ id: String) -> String { state.rows("accounts").first { $0.text("id") == id }?.text("name") ?? id }
    func money(_ amount: Double, _ currency: String? = nil) -> String {
        amount.formatted(.currency(code: currency ?? base))
    }
    func refresh() async {
        guard let database else { return }
        do {
            state = try await database.execute(["action": "snapshot"])
            let year = Calendar.current.component(.year, from: Date())
            summary = try await database.execute(["action": "summary", "year": String(year)])
        } catch { self.error = error.localizedDescription }
    }
    @discardableResult func command(_ request: Record) async -> Bool {
        guard let database else { return false }
        busy = true
        defer { busy = false }
        do { _ = try await database.execute(request); await refresh(); return true }
        catch { self.error = error.localizedDescription; return false }
    }
    func newTransaction(_ type: String = "expense") {
        editor = EditorRoute(kind: "transactions", value: ["type": type, "currency": base, "date": Self.today])
    }
    static var today: String { let f = DateFormatter(); f.locale = Locale(identifier:"en_US_POSIX"); f.calendar = Calendar(identifier:.gregorian); f.dateFormat = "yyyy-MM-dd"; return f.string(from: Date()) }
    func importFile() {
        let panel = NSOpenPanel(); panel.allowedContentTypes = [.json]; panel.canChooseDirectories = false
        panel.begin { response in
            guard response == .OK, let url = panel.url else { return }
            Task {
                do {
                    let json: Record = try await Task.detached {
                        let size = try url.resourceValues(forKeys:[.fileSizeKey]).fileSize ?? 0
                        guard size <= 100 * 1024 * 1024 else { throw LedgerFailure(message:"账本文件超过 100 MB") }
                        guard let json = try JSONSerialization.jsonObject(with:Data(contentsOf:url)) as? Record else { throw LedgerFailure(message:"账本不是有效 JSON 对象") }
                        return json
                    }.value
                    self.pendingImport = (json["state"] as? Record) ?? json
                } catch { self.error = error.localizedDescription }
            }
        }
    }
    func exportFile() {
        let panel = NSSavePanel(); panel.allowedContentTypes = [.json]; panel.nameFieldStringValue = "iLedger-\(Self.today).json"
        panel.begin { response in
            guard response == .OK, let url = panel.url else { return }
            do { try JSONSerialization.data(withJSONObject: self.state, options: [.prettyPrinted, .sortedKeys]).write(to: url, options: .atomic) }
            catch { self.error = error.localizedDescription }
        }
    }
}
