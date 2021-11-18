#! /usr/bin/env bash

set -e

ROOT_DIR="$1" # the directory in which "mkfiles.sh" is executed

WALLET_HOST="$2"
WALLET_PORT=8190

RECOVERY_PHRASE="$3"

while ! nc -z -w1 "$WALLET_HOST" $WALLET_PORT > /dev/null ; do
    echo "waiting for cardano-wallet..."
    sleep 2
done

# HACK:
# the "cardano-wallet" CLI tool can only connect to localhost.
# we use "socat" to proxy requests to a different host.
if [ "$WALLET_HOST" != "localhost" ] && [ "$WALLET_HOST" != "127.0.0.1" ]; then
    socat TCP-LISTEN:$WALLET_PORT,fork TCP:"$WALLET_HOST":$WALLET_PORT &
fi


function wait_for_positive_balance() {
    WALLET_ID="$1"
    local COUNT
    COUNT=0
    while : ; do
        COUNT=$((COUNT+1))
        QTY=$(cardano-wallet wallet get --port "$WALLET_PORT" "$WALLET_ID" 2>/dev/null |jq .balance.available.quantity)
        if [ "$QTY" -gt 0 ]; then
            break
        elif [ "$COUNT" -gt 15 ]; then
            echo "ERROR: Waited too long for funding of user wallet"
            exit 1
        else
            echo "Waiting for funding of user wallet..."
            sleep 5
        fi
    done
}

# Apply workaround for https://github.com/input-output-hk/cardano-wallet/issues/2919
echo "Sleeping for 60 seconds (bug workaround)..."
sleep 60

source setup_wallet.sh "$RECOVERY_PHRASE"

# Send all testnet funds to the user's wallet
USER_ADDRESS="$(cardano-wallet address list --port "$WALLET_PORT" "$USER_WALLET_ID" |jq -r '.[1].id')"
echo "Sending funds to user wallet address $USER_ADDRESS..."
"$ROOT_DIR/transfer_initial_funds.sh" "$USER_ADDRESS"
# Wait until the user has received the funds
wait_for_positive_balance "$USER_WALLET_ID"
echo "User wallet funded"
