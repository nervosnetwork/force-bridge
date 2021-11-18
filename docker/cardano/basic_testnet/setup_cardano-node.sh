#! /usr/bin/env bash

set -euo pipefail

# Run a private Cardano testnet using the `Dockerfile.cardano-node` image

ROOT_DIR="$1"
FUND_SCRIPT="$2"
INITIAL_FUNDS_SCRIPT_FILE="transfer_initial_funds.sh"

# Return a Bash script that uses "test_fund_user_wallet.sh" to send the initial funds
#  of the private testnet to the address provided as the first argument to the returned script
#
# Usage: funding_script <cardano_node_socket_path> <signing_key_file_path>
function funding_script() {
    local NODE_SOCKET_PATH="$1"
    local SIGNING_KEY_PATH="$2"

    echo "#!/usr/bin/env bash"
    echo ""
    echo "\"$FUND_SCRIPT\" \\"
    echo "   \"$NODE_SOCKET_PATH\" \\"
    echo "   \"$SIGNING_KEY_PATH\" \\"
    echo "   \$1"
}

# Write a script provided as the first argument to a file
#
# Usage: write_script_file <script_content> <file_name>
function write_script_file() {
    local SCRIPT_CONTENT="$1"
    local SCRIPT_PATH="$2"
    echo "$SCRIPT_CONTENT" > "$SCRIPT_PATH"
    chmod a+x "$SCRIPT_PATH"
}

# Reduce logging severity from Debug to Info
sed -i 's/minSeverity: Debug/minSeverity: Info/g' scripts/byron-to-alonzo/mkfiles.sh
scripts/byron-to-alonzo/mkfiles.sh alonzo

SOCKET_DIR="/cardano-node-sockets"

SIGNING_KEY_PATH="$ROOT_DIR/example/shelley/utxo-keys/utxo1.skey"
write_script_file \
    "$(funding_script "$SOCKET_DIR/node-bft1.sock" "$SIGNING_KEY_PATH")" \
    "$INITIAL_FUNDS_SCRIPT_FILE"

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

sleep 30s

# This allows cardano-cli/cardano-wallet running outside the docker to query the nodes
# Useful for debugging or running independent instances of cardano-wallet
chmod a+rw "$SOCKET_DIR/node-bft1.sock"
chmod a+rw "$SOCKET_DIR/node-bft2.sock"
chmod a+rw "$SOCKET_DIR/node-pool1.sock"

wait
