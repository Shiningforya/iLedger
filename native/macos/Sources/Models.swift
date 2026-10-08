import SwiftUI
import AVFoundation
import UniformTypeIdentifiers

final class ModelProcess: @unchecked Sendable {
    static let shared = ModelProcess()
    private let lock = NSLock()
    private var process: Process?
    private let queue = DispatchQueue(label:"com.iledger.inference", qos:.userInitiated)
    var directory: URL { FileManager.default.urls(for:.applicationSupportDirectory, in:.userDomainMask)[0].appendingPathComponent("iLedger Native/Models", isDirectory:true) }
    func cancel() { lock.lock(); process?.terminate(); lock.unlock() }
    func run(executable: URL, arguments: [String]) async throws -> String {
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                queue.async { [self] in
                    let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory:true)
                    do {
                        try FileManager.default.createDirectory(at:temporary, withIntermediateDirectories:true, attributes:[.posixPermissions:0o700])
                        defer { try? FileManager.default.removeItem(at:temporary) }
                        let out = temporary.appendingPathComponent("out"), err = temporary.appendingPathComponent("err")
                        FileManager.default.createFile(atPath:out.path, contents:nil, attributes:[.posixPermissions:0o600]); FileManager.default.createFile(atPath:err.path, contents:nil, attributes:[.posixPermissions:0o600])
                        let stdout = try FileHandle(forWritingTo:out), stderr = try FileHandle(forWritingTo:err)
                        defer { try? stdout.close(); try? stderr.close() }
                        let task = Process(); task.executableURL = executable; task.arguments = arguments; task.standardOutput = stdout; task.standardError = stderr; task.standardInput = FileHandle.nullDevice
                        lock.lock(); process = task; lock.unlock()
                        defer { lock.lock(); process = nil; lock.unlock() }
                        try task.run()
                        let timeout = DispatchWorkItem { if task.isRunning { task.terminate() } }
                        DispatchQueue.global().asyncAfter(deadline:.now() + 120, execute:timeout)
                        task.waitUntilExit(); timeout.cancel()
                        guard task.terminationStatus == 0 else { let detail = (try? String(contentsOf:err, encoding:.utf8)) ?? ""; throw LedgerFailure(message:"原生推理失败或已取消（\(task.terminationStatus)）：\(detail.suffix(600))") }
                        continuation.resume(returning:try String(contentsOf:out, encoding:.utf8))
                    } catch { continuation.resume(throwing:error) }
                }
            }
        } onCancel: { self.cancel() }
    }
    func install(from source: URL, speech: Bool) async throws {
        try await withCheckedThrowingContinuation { continuation in
            queue.async { [self] in
                do {
                    try FileManager.default.createDirectory(at:directory, withIntermediateDirectories:true)
                    let destination = directory.appendingPathComponent(speech ? "sensevoice" : "qwen.gguf")
                    let staged = directory.appendingPathComponent(UUID().uuidString)
                    defer { try? FileManager.default.removeItem(at:staged) }
                    if speech {
                        guard FileManager.default.fileExists(atPath:source.appendingPathComponent("model.int8.onnx").path), FileManager.default.fileExists(atPath:source.appendingPathComponent("tokens.txt").path) else { throw LedgerFailure(message:"目录中须包含 model.int8.onnx 和 tokens.txt") }
                        try FileManager.default.createDirectory(at:staged, withIntermediateDirectories:true)
                        for name in ["model.int8.onnx", "tokens.txt"] { try FileManager.default.copyItem(at:source.appendingPathComponent(name), to:staged.appendingPathComponent(name)) }
                    } else {
                        let file = try FileHandle(forReadingFrom:source); defer { try? file.close() }
                        guard try file.read(upToCount:4) == Data("GGUF".utf8) else { throw LedgerFailure(message:"文件不是有效 GGUF 模型") }
                        try FileManager.default.copyItem(at:source, to:staged)
                    }
                    if FileManager.default.fileExists(atPath:destination.path) { _ = try FileManager.default.replaceItemAt(destination, withItemAt:staged) }
                    else { try FileManager.default.moveItem(at:staged, to:destination) }
                    continuation.resume()
                } catch { continuation.resume(throwing:error) }
            }
        }
    }
    func understand(_ text: String, state: Record) async throws -> Record {
        let model = directory.appendingPathComponent("qwen.gguf")
        let executable = Bundle.main.bundleURL.appendingPathComponent("Contents/Helpers/llama/llama-completion")
        guard FileManager.default.fileExists(atPath:model.path), FileManager.default.isExecutableFile(atPath:executable.path) else { throw LedgerFailure(message:"请先在设置中安装 Qwen GGUF 模型；应用还需包含 llama.cpp 原生引擎。") }
        let catalog: Record = ["categories":state.rows("categories").map { ["name":$0.text("name"), "type":$0.text("type")] }, "accounts":state.rows("accounts").filter { !$0.text("parentAccountId").isEmpty }.map { ["id":$0.text("id"), "name":$0.text("name")] }, "currencies":state.rows("rates").map { $0.text("code") }]
        let library = String(decoding:try JSONSerialization.data(withJSONObject:catalog), as:UTF8.self)
        let prompt = "<|im_start|>system\n将用户记账内容解析为 JSON。只返回 item,type,amount,currency,category,accountId。type 为 expense 或 income。类别、账户、币种只从以下资料选择。资料：\(library)<|im_end|>\n<|im_start|>user\n\(text)<|im_end|>\n<|im_start|>assistant\n"
        let schema = #"{"type":"object","properties":{"item":{"type":"string"},"type":{"enum":["expense","income"]},"amount":{"type":"number"},"currency":{"type":"string"},"category":{"type":"string"},"accountId":{"type":"string"}},"required":["item","type","amount","currency","category","accountId"],"additionalProperties":false}"#
        let promptURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".txt")
        try Data(prompt.utf8).write(to:promptURL, options:.atomic)
        try FileManager.default.setAttributes([.posixPermissions:0o600], ofItemAtPath:promptURL.path)
        defer { try? FileManager.default.removeItem(at:promptURL) }
        let output = try await run(executable:executable, arguments:["-m",model.path,"-f",promptURL.path,"-n","256","-c","4096","-t","4","--temp","0","--no-display-prompt","--no-conversation","--json-schema",schema,"--no-perf","--simple-io","--color","off"])
        guard let start = output.firstIndex(of:"{"), let end = output.lastIndex(of:"}"), let record = try JSONSerialization.jsonObject(with:Data(output[start...end].utf8)) as? Record else { throw LedgerFailure(message:"模型未返回有效结构，请检查模型或改用基础识别。") }
        return record
    }
    func transcribe(_ wav: URL) async throws -> String {
        let executable = Bundle.main.bundleURL.appendingPathComponent("Contents/Helpers/speech/iledger-speech")
        let model = directory.appendingPathComponent("sensevoice")
        guard FileManager.default.isExecutableFile(atPath:executable.path), FileManager.default.fileExists(atPath:model.appendingPathComponent("model.int8.onnx").path) else { throw LedgerFailure(message:"请先安装 SenseVoice 中文模型与原生语音引擎。") }
        return try await run(executable:executable, arguments:[model.path,wav.path]).trimmingCharacters(in:.whitespacesAndNewlines)
    }
}

struct ModelSettingsView: View {
    @State private var status = ""
    @State private var busy = false
    var body: some View {
        Form {
            Section("高级文字理解 · Qwen2.5 1.5B") {
                Link("官方 GGUF 模型", destination:URL(string:"https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF")!)
                Button("安装 GGUF 文件…") { choose(false) }.disabled(busy)
            }
            Section("中文语音 · SenseVoice Small") {
                Link("官方模型", destination:URL(string:"https://k2-fsa.github.io/sherpa/onnx/sense-voice/pretrained.html")!)
                Button("安装模型文件夹…") { choose(true) }.disabled(busy)
            }
            if busy { ProgressView() }
            Text(status).foregroundStyle(.secondary)
        }.formStyle(.grouped)
    }
    func choose(_ speech: Bool) {
        let panel = NSOpenPanel(); panel.canChooseDirectories = speech; panel.canChooseFiles = !speech
        panel.begin { response in guard response == .OK, let url = panel.url else { return }; busy = true; Task {
            defer { busy = false }
            do { try await ModelProcess.shared.install(from:url, speech:speech); status = "模型文件已安装。首次识别时将验证实际运行。" } catch { status = error.localizedDescription }
        } }
    }
}

struct RecognitionView: View {
    @EnvironmentObject var model: LedgerModel
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var advanced = false
    @State private var busy = false
    @State private var recorder: AVAudioRecorder?
    @State private var audioURL: URL?
    @State private var task: Task<Void, Never>?
    @State private var result: EditorRoute?
    var body: some View {
        VStack(alignment:.leading, spacing:16) {
            Text("文字与语音记账").font(.title2.bold())
            TextEditor(text:$text).frame(minHeight:130).border(.quaternary)
            Toggle("高级模型理解", isOn:$advanced)
            HStack {
                Button { Task { await record() } } label: { Label(recorder == nil ? "录音" : "停止录音", systemImage:recorder == nil ? "mic" : "stop.fill") }.disabled(busy)
                if busy { ProgressView().controlSize(.small); Button("取消识别") { task?.cancel(); ModelProcess.shared.cancel() } }
                Spacer(); Button("关闭") { dismiss() }; Button("识别") { recognize() }.buttonStyle(.borderedProminent).disabled(busy || text.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty)
            }
        }.padding(24).frame(width:550)
        .sheet(item:$result) { RecordEditor(route:$0).environmentObject(model) }
        .onDisappear { recorder?.stop(); task?.cancel(); ModelProcess.shared.cancel(); if let audioURL { try? FileManager.default.removeItem(at:audioURL) } }
    }
    func recognize() {
        task = Task {
            busy = true; defer { busy = false }
            do {
                guard let database = model.database else { return }
                var request: Record = ["action":"parse", "text":text, "date":LedgerModel.today]
                if advanced { request["value"] = try await ModelProcess.shared.understand(text, state:model.state); request["action"] = "resolveModel" }
                let record = try await database.execute(request)
                try Task.checkCancellation(); result = EditorRoute(kind:"transactions", value:record)
            } catch is CancellationError { } catch { model.error = error.localizedDescription }
        }
    }
    func record() async {
        if let recorder, let audioURL {
            recorder.stop(); self.recorder = nil; busy = true
            task = Task { defer { busy = false; try? FileManager.default.removeItem(at:audioURL) }; do { text = try await ModelProcess.shared.transcribe(audioURL) } catch { model.error = error.localizedDescription } }; return
        }
        guard await AVCaptureDevice.requestAccess(for:.audio) else { model.error = "请在系统设置中允许 iLedger 使用麦克风。"; return }
        do {
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".wav"); audioURL = url
            let recorder = try AVAudioRecorder(url:url, settings:[AVFormatIDKey:kAudioFormatLinearPCM, AVSampleRateKey:16000, AVNumberOfChannelsKey:1, AVLinearPCMBitDepthKey:16, AVLinearPCMIsFloatKey:false, AVLinearPCMIsBigEndianKey:false])
            guard recorder.record(forDuration:60) else { throw LedgerFailure(message:"无法开始录音") }; self.recorder = recorder
        } catch { model.error = error.localizedDescription }
    }
}
