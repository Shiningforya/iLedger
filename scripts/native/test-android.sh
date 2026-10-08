#!/usr/bin/env bash
set -euo pipefail

status=0
bash native/android/gradlew -p native/android --no-daemon connectedDebugAndroidTest || status=$?
adb pull /sdcard/Download/iledger-native-screenshots native/android/app/build/reports/screenshots || {
  if [ "$status" -eq 0 ]; then status=1; fi
}
exit "$status"
