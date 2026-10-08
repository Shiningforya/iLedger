# iLedger Native (development candidate)

This is an in-progress native rewrite, not a replacement release for iLedger 0.1.2.
The existing `src/`, `desktop/`, and `android/` applications are retained for migration
and regression comparison. They are not embedded in this application.

## Architecture

| Layer | Implementation |
| --- | --- |
| macOS | SwiftUI, AppKit file panels, Swift Charts, AVFoundation, URLSession, Keychain |
| Android | Kotlin, Jetpack Compose / Material 3, ViewModel / SavedStateHandle, JNI |
| Windows | C# / WinUI 3, Windows App SDK, native file pickers, P/Invoke |
| Shared accounting | C++17, SQLite WAL transactions, C ABI |
| macOS language runtime | llama.cpp + a locally installed Qwen2.5 1.5B GGUF |
| macOS speech runtime | sherpa-onnx + locally installed SenseVoice Small int8 |

No HTML, DOM, WebView, Electron, Capacitor, JavaScript inference, or browser storage
is used at runtime. Node is a build/test tool only. Sharing the accounting engine
keeps transaction, account, currency and companion-record mutations atomic across
the three UIs.

## Safety and Status

- App identifiers and data directories are separate from the old app.
- Fresh installations contain categories and currencies, but no personal accounts
  or sample transactions. Icons derive from `public/iledger-favicon.svg`.
- `native/version.json` is the source for all native platform versions. `0.2.0 (3)`
  currently identifies a development candidate, not a published stable release.
- Imports require confirmation and validate before replacing the database. The
  previous state is stored in the same SQLite transaction. `restoreImportBackup`
  reverses an import; reversing also retains the state being replaced.
- Native macOS WebDAV defaults to a **different remote filename** from the old app.
  Passwords are stored in Keychain, not exported with the ledger. Uploads use ETag
  preconditions. Background automatic synchronization is not implemented yet.
- No automatic legacy migration or replacement of existing installed apps occurs.
- **Do not use this candidate as the sole copy of a real ledger.** Feature parity,
  device performance, signed distribution and migration acceptance are incomplete.

See [validation.md](docs/validation.md) for tested results and release blockers.

## Build

From the repository root, with Node 22 and existing npm dependencies installed:

```sh
npm ci
node scripts/native/setup.mjs
node scripts/native/prepare-platforms.mjs
```

Dependencies are pinned with hashes in `dependencies.json`. The setup script rejects
incomplete or modified downloads. `.deps/` and `.build/` are ignored by Git. Generated
Android and Windows icons and the copied Gradle wrapper JAR are also ignored.

### macOS (Apple Silicon)

Requires macOS 14+ and a working Xcode / Command Line Tools Swift toolchain.

```sh
node scripts/native/setup.mjs --mac-model-engines
npm run native:test
npm run native:mac
open 'native/.build/iLedger Native.app'
```

The output is an ad-hoc-signed `.app`, **not** a notarized distribution DMG. Use
`ILEDGER_DATA_DIR` to isolate UI test data. Full Xcode and an Apple distribution
identity are still required for release signing/notarization. Models are installed
from Settings; a successful file copy is not reported as successful inference.
Use the `Q4_K_M` GGUF for Qwen. For SenseVoice, choose a directory containing
`model.int8.onnx` and `tokens.txt`. Verified downloads are also available through
`node scripts/native/setup.mjs --qwen --sensevoice`; they go into `.deps/`, not
automatically into the app's model directory. Model weights are not bundled with
the application. The development candidate currently runs Qwen on CPU; see the
validation record for measured CI latency and remaining performance work.
The local SDK is 15.5, so this candidate uses native system materials and controls;
it does not pretend that CSS or an older material is the SDK 26 `glassEffect` API.

### Android

Requires JDK 21, Android SDK 36, NDK 28.2.13676358, and CMake 3.22.1.

```sh
npm run native:android
bash native/android/gradlew -p native/android connectedDebugAndroidTest
```

The output is a **debug candidate APK** under `native/android/app/build/outputs/`.
It has a separate application ID (`com.iledger.nativeapp`) and cannot overwrite the
old app. NDK libraries use 16 KB page alignment. Release builds enable R8; device
frame-time measurements must use a release/profileable build, not debug timings.

### Windows

Requires Windows, .NET 8, Visual Studio C++ build tools, Windows SDK and CMake.

```powershell
npm run native:windows
```

The output is an unpackaged WinUI candidate folder under `native/.build/windows-app`.
Copying only the EXE is insufficient: native libraries and Windows App SDK files
must accompany it. Signed MSIX/installer distribution has not been implemented.

## Official Documentation Used

- [Apple navigation](https://developer.apple.com/documentation/swiftui/navigationsplitview)
- [Apple Liquid Glass](https://developer.apple.com/documentation/swiftui/applying-liquid-glass-to-custom-views)
- [Android Back navigation](https://developer.android.com/guide/navigation/custom-back/predictive-back-gesture)
- [Android adaptive layouts](https://developer.android.com/develop/adaptive-apps)
- [Compose performance](https://developer.android.com/develop/ui/compose/performance)
- [Android app versioning](https://developer.android.com/studio/publish/versioning)
- [Android performance measurement](https://developer.android.com/topic/performance/benchmarking/macrobenchmark-overview)
- [WinUI 3](https://learn.microsoft.com/en-us/windows/apps/winui/)
- [Unpackaged WinUI deployment](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/unpackage-winui-app)
- [llama.cpp](https://github.com/ggml-org/llama.cpp)
- [Qwen GGUF](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF)
- [SenseVoice native inference](https://k2-fsa.github.io/sherpa/onnx/sense-voice/pretrained.html)

## Remaining Work

The old customizable/resizable tiles, credit bill generation and repayment scheduling,
installments, automatic subscription renewal/expiry, CSV mapping/deduplication/review,
full recognition learning, automatic sync, all three platforms' model management,
the original theme/glass controls and configurable slogans, and complete
accessibility/localization have **not** reached feature parity.
The platform UIs also have unequal workflow coverage: Android and Windows do not
yet expose every macOS action (including the complete account-transfer/deletion
and loan-repayment flows). A shared core action or a successful build does not
mean that every platform exposes a finished user workflow.
Native controls resolve the architectural dependency on browser behavior, but do
not by themselves prove that the application is smooth or correct on every device.
