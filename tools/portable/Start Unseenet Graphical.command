#!/bin/sh
# Start Unseenet (graphical client) from this folder (macOS). Double-click it in the Finder.
# The first time, macOS may say the developer cannot be verified: right-click
# this file, choose Open, and confirm. See README-graphical.txt.
HERE=$(cd "$(dirname "$0")" && pwd)
case "$(uname -m)" in arm64) ARCH=aarch64 ;; *) ARCH=x86_64 ;; esac
BIN="$HERE/gui-macos-$ARCH/unseenet-gui"
if [ ! -f "$BIN" ]; then
    echo "Unseenet graphical for macOS ($ARCH) is not in this folder."
    read -r _
    exit 1
fi
xattr -dr com.apple.quarantine "$HERE/gui-macos-$ARCH" 2>/dev/null
printf '\033]0;Unseenet (close the Unseenet window to stop)\007'
exec "$BIN" "$@"
