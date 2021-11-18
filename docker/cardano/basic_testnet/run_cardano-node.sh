#! /usr/bin/env bash

set -euo pipefail

# Run a private Cardano testnet using the `Dockerfile.cardano-node` image

SOCKET_DIR="/cardano-node-sockets"

TMP_DIR=$(mktemp -d)

echo "$TMP_DIR"

cp -a "$PWD"/* "$TMP_DIR"
cd "$TMP_DIR"
echo $(ls -l "$PWD")

cardano-node run \
  --config                          example/configuration.yaml \
  --topology                        example/node-bft1/topology.json \
  --database-path                   example/node-bft1/db \
  --socket-path                     "$SOCKET_DIR/node-bft1.sock" \
  --shelley-kes-key                 example/node-bft1/shelley/kes.skey \
  --shelley-vrf-key                 example/node-bft1/shelley/vrf.skey \
  --shelley-operational-certificate example/node-bft1/shelley/node.cert \
  --port                            3001 \
  --delegation-certificate          example/node-bft1/byron/delegate.cert \
  --signing-key                     example/node-bft1/byron/delegate.key \
  | tee -a example/node-bft1/node.log &


cardano-node run \
  --config                          example/configuration.yaml \
  --topology                        example/node-bft2/topology.json \
  --database-path                   example/node-bft2/db \
  --socket-path                     "$SOCKET_DIR/node-bft2.sock" \
  --shelley-kes-key                 example/node-bft2/shelley/kes.skey \
  --shelley-vrf-key                 example/node-bft2/shelley/vrf.skey \
  --shelley-operational-certificate example/node-bft2/shelley/node.cert \
  --port                            3002 \
  --delegation-certificate          example/node-bft2/byron/delegate.cert \
  --signing-key                     example/node-bft2/byron/delegate.key \
  | tee -a example/node-bft2/node.log &


cardano-node run \
  --config                          example/configuration.yaml \
  --topology                        example/node-pool1/topology.json \
  --database-path                   example/node-pool1/db \
  --socket-path                     "$SOCKET_DIR/node-pool1.sock" \
  --shelley-kes-key                 example/node-pool1/shelley/kes.skey \
  --shelley-vrf-key                 example/node-pool1/shelley/vrf.skey \
  --shelley-operational-certificate example/node-pool1/shelley/node.cert \
  --port                            3003 \
  | tee -a example/node-pool1/node.log &

sleep 5s
chmod a+rw "$SOCKET_DIR/node-bft1.sock"
chmod a+rw "$SOCKET_DIR/node-bft2.sock"
chmod a+rw "$SOCKET_DIR/node-pool1.sock"

wait
