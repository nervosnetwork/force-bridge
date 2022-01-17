#!/usr/bin/env bash

set -e

USER_WALLET_RECOVERY_PHRASE="$1"
WALLET_PORT=8190

if [ ! "$1" ] ; then
    echo "ERROR: Missing 15–24 word recovery phrase."
    echo "Usage: $0 <user_wallet_recovery_phrase>";
    exit 1;
fi

# Generate a wallet.
# Usage: generate_wallet <wallet_name> <passphrase> <recovery_phrase>
# Returns: wallet ID
function generate_wallet() {
    local WALLET_NAME="$1"
    local PASSPHRASE="$2"
    local RECOVERY_PHRASE="$3"

    local WALLET_ID
    WALLET_ID=$(cardano-wallet wallet create from-recovery-phrase --port "$WALLET_PORT" "$WALLET_NAME" < <(printf "%s\n" "$RECOVERY_PHRASE" "" "$PASSPHRASE" "$PASSPHRASE") |jq -r .id)
    echo "Created new wallet with ID $WALLET_ID" 1>&2
    echo "$WALLET_ID"
}

# Wait until the wallet is done syncing
# Usage: wait_for_sync <wallet_id>
function wait_for_sync() {
    local WALLET_ID="$1"
    while : ; do
        JSON=$(cardano-wallet wallet get --port "$WALLET_PORT" "$WALLET_ID" 2>/dev/null |jq .state)
        STATUS="$(jq -r .status <<< "$JSON")"

        if [ "$STATUS" == "syncing" ]; then
            PROGRESS=$(jq -r .progress.quantity <<< "$JSON")
            UNIT=$(jq -r .progress.unit <<< "$JSON")
            echo "Wallet not ready. Progress: $PROGRESS $UNIT"
            sleep 5
        elif [ "$STATUS" == "ready" ]; then
            echo "Wallet ready"
            break
        else
            echo "ERROR: Unknown wallet status: $STATUS"
            echo "Debug info:"
            echo "$JSON"
            exit 1
        fi
    done
}

############
## 1. SETUP
############

# Generate user wallet
USER_WALLET_PASSPHRASE="user_wallet_passphrase"
USER_WALLET_ID=$(generate_wallet "user_test_wallet" "$USER_WALLET_PASSPHRASE" "$USER_WALLET_RECOVERY_PHRASE")

wait_for_sync "$USER_WALLET_ID"
