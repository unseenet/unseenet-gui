#!/bin/sh
# A local playground: a node without Tor, three people, a few groups and a chat.
# Everything lives in ./dev and can be deleted. Not for real use: the vaults
# use a fast, weak key derivation and the passphrase "test".
#
#   tools/dev.sh            start node, seed it (first time) and open the client
#   tools/dev.sh clean      delete ./dev
set -e
cd "$(dirname "$0")/.."
DEV=dev
if [ "$1" = "clean" ]; then rm -rf "$DEV"; echo "removed $DEV"; exit 0; fi
mkdir -p "$DEV"
export UNSEENET_INSECURE_FAST_KDF=1 UNSEENET_NODE_PASSPHRASE=dev
# no key ripening on the playground (UN-RFC 0025): new keys would work minutes each first
# (in [node]: settings outside it are not read, so min_pow used to stay at 18)
[ -f "$DEV/node.toml" ] || printf '[node]\nmin_pow = 12\nmin_ripe = "-"\n' > "$DEV/node.toml"

unseenet-node --data "$DEV/node-data" --config "$DEV/node.toml" --no-tor --listen 127.0.0.1:1119 \
  > "$DEV/node.log" 2>&1 &
NODE=$!
trap 'kill $NODE 2>/dev/null' EXIT INT TERM
sleep 2

if [ ! -f "$DEV/andreas.vault" ]; then
  echo "Seeding the node (proof-of-work takes a moment) ..."
  python tools/seed_dev.py "$DEV"
fi
echo "Passphrase for every vault in $DEV: test"
unseenet-gui --vault "$DEV/andreas.vault" "$@"
