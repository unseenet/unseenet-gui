#!/bin/sh
# Start Unseenet (graphical client) from this folder (Linux):
#     sh /path/to/Unseenet/start-graphical-linux.sh
# It opens in a Chromium-family browser without tabs (Chrome, Chromium, Edge,
# Brave) if one is installed, else in your browser. Extra arguments are passed
# on, e.g. "sh start-graphical-linux.sh --self-test".
HERE=$(cd "$(dirname "$0")" && pwd)
ARCH=$(uname -m)
case "$ARCH" in amd64) ARCH=x86_64 ;; arm64) ARCH=aarch64 ;; esac
BIN="$HERE/gui-linux-$ARCH/unseenet-gui"
if [ ! -f "$BIN" ]; then
    echo "Unseenet graphical for Linux ($ARCH) is not in this folder." >&2
    exit 1
fi
if [ -x "$BIN" ]; then
    exec "$BIN" "$@"
fi
# FAT-formatted USB sticks are often mounted without execute permission;
# the system's program loader can still start the program.
for LD in /lib64/ld-linux-x86-64.so.2 /lib/ld-linux-aarch64.so.1 /lib/x86_64-linux-gnu/ld-linux-x86-64.so.2; do
    if [ -e "$LD" ]; then
        exec "$LD" "$BIN" "$@"
    fi
done
echo "Cannot start $BIN: the stick is mounted without execute permission." >&2
exit 1
