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

## Not Yet Verified

- Android source compilation, emulator tests, physical device Back gestures,
  rotation/process recreation, keyboard insets, release jank and 16 KB runtime.
- Windows source compilation and actual WinUI UI, high DPI, accessibility and packaging.
- Qwen inference and SenseVoice recognition on real audio. Model weight downloads
  repeatedly timed out or returned partial files. No WER/CER or latency claim is made.
- Native WebDAV login, ETag conflict behavior and logout against a live account.
  The code uses URLSession and Keychain, but no real credentials were used in tests.
- Legacy imports across all historical schemas. Unsupported relationships fail
  validation rather than silently remapping or overwriting data.
- Large-ledger interactive frame times and concurrent process access.

## Release Blockers

1. Complete old feature parity, especially CSV, credit bills/installments, automatic
   subscription processing, recognition corrections and configurable tiles.
2. Complete all native cloud/model implementations and test actual inference. File
   existence, a copied model, or a callable engine are not successful inference.
3. Run the three-platform CI plus Android instrumentation, then physical Android
   release benchmarks on the user's device classes. Capture p50/p95/p99 frame times,
   scroll and navigation traces; do not label an unmeasured app "60/120 fps".
4. Test 360x640, 360x720, 400x640, landscape, tablets, font scale 1.0/1.5/2.0,
   keyboard-open forms, nested Back, process death, and TalkBack/VoiceOver/Narrator.
5. Add migration golden fixtures and round-trip comparison for every old collection.
6. Finish platform signing, notarization/MSIX/APK release signing, upgrade/uninstall
   behavior, third-party notice audit, crash reporting consent and backup recovery.

Until those gates pass, the candidate must not replace the released app or be
described as a completed three-platform rewrite.
