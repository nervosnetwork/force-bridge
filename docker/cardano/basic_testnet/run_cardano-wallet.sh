#! /usr/bin/env bash

set -e

# Run `cardano-wallet serve` that is connected to the testnet from `run_cardano-node.sh`

ROOT_DIR="$1" # the directory in which "mkfiles.sh" is executed
SOCKET_DIR="/cardano-node-sockets"
SOCKET_FILE="$SOCKET_DIR/node-bft1.sock"
WALLET_PORT=8190

while ! ls "$SOCKET_FILE" 2> /dev/null ; do
    echo "waiting for cardano-node..."
    sleep 2
done
echo "cardano-node ready!"

cardano-wallet serve \
    --node-socket "$SOCKET_FILE" \
    --testnet "$ROOT_DIR/example/byron/genesis.json" \
    --database "$ROOT_DIR/wallet-data" \
    --listen-address 0.0.0.0 \
    --port "$WALLET_PORT"
