#!/bin/sh
# Start Unseenet (web client) from this folder (macOS). Double-click it in the Finder.
# The first time, macOS may say the developer cannot be verified: right-click
# this file, choose Open, and confirm. See README-web.txt.
HERE=$(cd "$(dirname "$0")" && pwd)
case "$(uname -m)" in arm64) ARCH=aarch64 ;; *) ARCH=x86_64 ;; esac
BIN="$HERE/web-macos-$ARCH/unseenet-web"
if [ ! -f "$BIN" ]; then
    echo "Unseenet web for macOS ($ARCH) is not in this folder."
    read -r _
    exit 1
fi
xattr -dr com.apple.quarantine "$HERE/web-macos-$ARCH" 2>/dev/null
printf '\033]0;Unseenet (close the Unseenet window to stop)\007'
exec "$BIN" "$@"
