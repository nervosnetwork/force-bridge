#!/usr/bin/env bash

set -e

VERIFICATION_KEY_FILE="addr.vkey"

NODE_SOCKET_PATH="$1"
# Path to a Cardano "signing key" that owns the funds used to execute the tests
FUNDED_SIGNING_KEY_FILE="$2"
# User address to fund
USER_ADDRESS="$3"

export CARDANO_NODE_SOCKET_PATH="$NODE_SOCKET_PATH"

# Debug logging
echo "Running user wallet funding script. Arguments:" >&2
echo "   NODE_SOCKET_PATH: $NODE_SOCKET_PATH" >&2
echo "   FUNDED_SIGNING_KEY_FILE: $FUNDED_SIGNING_KEY_FILE" >&2
echo "   USER_ADDRESS: $USER_ADDRESS" >&2

# Create verification key for signing key
cardano-cli key verification-key \
            --signing-key-file "$FUNDED_SIGNING_KEY_FILE" \
            --verification-key-file "$VERIFICATION_KEY_FILE"
ADDRESS="$(cardano-cli address build --testnet-magic 42 --payment-verification-key-file $VERIFICATION_KEY_FILE)"

TX_IN="$(cardano-cli query utxo --address "$ADDRESS" --testnet-magic 42| awk '{print $1}' |sed -n '3,3p')#0"
BALANCE="$(cardano-cli query utxo --address "$ADDRESS" --testnet-magic 42| awk '{print $3}' |sed -n '3,3p')"
FEE=10000
cardano-cli transaction build-raw \
            --invalid-hereafter 100000 \
            --fee "$FEE" \
            --tx-in "${TX_IN}" \
            --tx-out "$USER_ADDRESS+$((BALANCE-FEE))" \
            --out-file tx.txbody

cardano-cli transaction sign \
            --signing-key-file "$FUNDED_SIGNING_KEY_FILE" \
            --testnet-magic 42 \
            --tx-body-file  tx.txbody \
            --out-file      tx.tx

cardano-cli transaction submit --tx-file tx.tx --testnet-magic 42
