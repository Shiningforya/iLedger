# Native Candidate Validation

Date: 2026-10-08. This is a development record, not release approval.

## Confirmed Legacy Causes

1. `src/localModels.ts` uses browser Transformers with Q4F16/WebGPU and checks
   `Float16Array`. Installing Electron did not replace this with native inference.
   The speech pack is multilingual Whisper Tiny Q4, not a Chinese-specialized model.
2. `android/app/build.gradle` hardcodes versionName 0.1.1 while the web package is
   0.1.2. This is a build metadata integration bug, not proof that all hybrid apps
   are inherently invalid.
3. `Dashboard.tsx` has `xs: 1` in the responsive column definition. A one-column
   portrait layout was configured, not caused by low hardware performance.
4. The browser shell has no nested Android Back dispatcher integration.
5. Browser tap/focus feedback and expensive overlapping glass/compositing are
   plausible contributors to the reported blue rectangles and jank. They were not
   measured on the reported devices, so neither is a proven sole cause.

## Passed Locally

### Native shared core

`node native/core/tests/accounting.test.mjs` passed using a compiled C++ executable
and a temporary SQLite database (not browser mocks).

| Case | Evidence / assertion |
| --- | --- |
| Empty install | No accounts or transactions; presets retained |
| Foreign expense | 20 USD at 7.1 -> 142 CNY; balance 1000 -> 858 |
| Subscription + depreciation | Both companions store 142 CNY and follow name changes |
| Base change | CNY -> USD leaves existing accounts and transactions deeply equal |
| Rate change + text edit | Changing rate to 9 and editing a name keeps balance 858 |
| Currency edit | Changing original USD to EUR recomputes using EUR, not old USD FX |
| Delete | Restores frozen account debit and removes companion records |
| Borrow / repay / undo | Repayment closes loan; deleting repayment reopens it |
| Invalid references | Parent account cannot be used for settlement; mutation rolls back |
| Revision conflict | Stale expectedRevision rejected without mutation |
| Native recognition | Explicit VISA, 20, 美刀 and category aliases beat model suggestions |
| Currency in account name | 人民币余额 does not override the explicit 20 美元 amount |
| Rename category | Related subscription and transaction category updated |
| Restart | Exact state survives process restart |
| Bad import | Existing state unchanged |
| Pagination | 101 rows -> six pages at 20; page size capped at 100; no rows discarded |
| Import recovery | Prior state survives process restart; recovery itself is reversible |
| Migrated credit edit | Credit ID, repayment order and settings retained, no duplicate tool |

The existing web application's `npm test` suite also passed before final validation.
It remains a reference suite; passing it does not prove native feature parity.

### macOS build and actual UI

- SwiftUI executable and C++ SQLite library compiled on Apple Silicon with SDK 15.5.
- `codesign --verify --deep --strict` passed for the generated `.app`.
- `otool -L` confirmed the native UI/system frameworks, not an Electron/WebView UI.
- Official pinned llama.cpp executable ran and printed version b11482.
- sherpa-onnx helper compiled, loaded its packaged dynamic libraries, and displayed
  its CLI usage. This is an engine-loading check, not a speech accuracy test.
- CUA launched the actual app with `ILEDGER_DATA_DIR=/tmp/iledger-native-ui-test`.
- Native UI entry created a parent, a CNY child with 1000 balance, and a 20 USD
  expense at manual FX 7.1 with both subscription and depreciation enabled.
- Screenshots and accessibility state confirmed account balance 858, companion
  amounts 142, and natural January-December order in the annual chart.
- No production local ledger, installed old app, or cloud file was changed.

## Independent CI

[Run 37727382033](https://github.com/Shiningforya/iLedger/actions/runs/37727382033)
validates commit `ca86b53547afebb1183db00db7776aa556875185`. All three jobs passed.

- macOS: native build, signature verification, compiled SQLite tests, actual Qwen
  inference and actual SenseVoice recognition passed on the ARM64 macOS runner.
- Windows: MSVC compiled the C++ core; .NET / Windows App SDK compiled and published
  the WinUI executable and dependencies. The compiled Windows accounting tests passed.
- Android: Compose / JNI APK and instrumentation APK compiled; `lintDebug` passed.
  Four tests passed on the Android 15 / API 35 x86_64 Pixel 6 emulator, with zero
  failures and zero skipped tests: system Back dismisses nested forms in order;
  the portrait dashboard has two small metric tiles on one row; Activity recreation
  preserves the form draft with amount/save controls visible; PackageManager's
  installed version matches the central build definition.
- Android screenshots were downloaded and visually inspected: the portrait
  dashboard, nested category form, return to dashboard, and restored transaction
  form. The final settled capture shows the amount field and save/cancel controls
  correctly. Local evidence: `native/.build/validation/android-settled/`.
- The first emulator was only 320dp wide, so an early conditional two-column
  assertion did not execute. That result is not counted as layout coverage. The
  final test requires a Pixel 6 viewport and has an unconditional assertion.
  System Back tests now send real key events to the focused native window instead
  of relying on Espresso to select the underlying Activity behind a Dialog.

### Model evidence

The model tests download SHA-256-verified weights and execute the same native helper
binaries and arguments packaged with the app. They do not substitute parsing rules
for the language model or provide a prerecorded transcription as inference output.
The following timing evidence is from the first successful
[CPU run](https://github.com/Shiningforya/iLedger/actions/runs/37723882147); the final
run above repeats and passes both language fixtures and the speech fixture.

| Input | Actual native output | Runner elapsed time |
| --- | --- | --- |
| 用人民币余额账户购买 ChatGPT，支出20美元，类别为学习 | ChatGPT / expense / 20 / USD / 学习 / cny | 108.45 s |
| 工资收入300人民币，存入人民币余额账户 | 工资收入 / income / 300 / CNY / 工资 / cny | 78.91 s |
| Official SenseVoice `zh.wav` | 开饭时间早上9点至下午5点。 | Under 2 s for this sample |

The initial Metal run timed out. Explicit CPU execution passed, so CPU is the
candidate's verified default. Qwen's 79-108 second cold-run latency on a virtualized
runner is **not acceptable evidence of interactive performance**. Physical-Mac
latency, model lifetime/caching, cancellation, and optional Metal acceleration need
further measurement. One public speech sample does not establish Chinese WER/CER,
microphone accuracy, dialect coverage, or superiority over the previous model.

## Not Yet Verified

- Android physical device Back gestures, process death (distinct from tested Activity
  recreation), keyboard insets, release jank and 16 KB runtime.
- Actual Windows WinUI UI, high DPI, accessibility and signed packaging.
- Model download/install through the macOS file-picker UI and microphone recording.
  Local weight downloads timed out; inference tests used CI-downloaded weights.
  No general WER/CER or physical-device performance claim is made.
- Native WebDAV login, ETag conflict behavior and logout against a live account.
  The code uses URLSession and Keychain, but no real credentials were used in tests.
- Legacy imports across all historical schemas. Unsupported relationships fail
  validation rather than silently remapping or overwriting data.
- Large-ledger interactive frame times and concurrent process access.

## Release Blockers

1. Complete old feature parity, especially CSV, credit bills/installments, automatic
   subscription processing, recognition corrections and configurable tiles. Check
   each platform's create/edit/delete/transfer/repay entry points separately;
   shared-core coverage is not proof of UI workflow parity.
2. Complete Android/Windows native cloud/model implementations and benchmark actual
   inference across platforms. File existence, a copied model, or a callable engine
   are not successful inference.
3. Extend the passed three-platform CI and Android instrumentation with physical
   Android release benchmarks on the user's device classes. Capture p50/p95/p99 frame times,
   scroll and navigation traces; do not label an unmeasured app "60/120 fps".
4. Test 360x640, 360x720, 400x640, landscape, tablets, font scale 1.0/1.5/2.0,
   keyboard-open forms, nested Back, process death, and TalkBack/VoiceOver/Narrator.
5. Add migration golden fixtures and round-trip comparison for every old collection.
6. Finish platform signing, notarization/MSIX/APK release signing, upgrade/uninstall
   behavior, third-party notice audit, crash reporting consent and backup recovery.

Until those gates pass, the candidate must not replace the released app or be
described as a completed three-platform rewrite.
