#!/bin/bash

export PATH=/bitcoin-0.20.0/bin:$PATH

bitcoind -conf=/etc/bitcoin/bitcoin.conf -rpcport=18443
sleep 8

MINER_ADDRESS=bcrt1q0yszr82fk9q8tu9z9ddxxvwqmlrdycsy378znz
ALICE_ADDRESS=bcrt1q4r9hqljdpfwxu6gp3x7qqedg77r6408dn4wmnf
BOB_ADDRESS=bcrt1qfzdcp53u29yt9u5u3d0sx3u2f5xav7sqatfxm2

bitcoin-cli -conf=/etc/bitcoin/bitcoin.conf createwallet miner
bitcoin-cli -conf=/etc/bitcoin/bitcoin.conf -rpcwallet="miner" importprivkey "cURtxPqTGqaA5oLit5sMszceoEAbiLFsTRz7AHo23piqamtxbzav"
bitcoin-cli -conf=/etc/bitcoin/bitcoin.conf createwallet alice
bitcoin-cli -conf=/etc/bitcoin/bitcoin.conf -rpcwallet="alice" importprivkey "cUDfdzioB3SqjbN9vutRTUrpw5EH9srrg6RPibacPo1fGHpfPKqL"
bitcoin-cli -conf=/etc/bitcoin/bitcoin.conf createwallet bob
bitcoin-cli -conf=/etc/bitcoin/bitcoin.conf -rpcwallet="bob" importprivkey "cU9PYTnSkcWoAE15U26JJCwtKiYvTCKYdbWt8e7ovidEGDBwJQ5x"

bitcoin-cli -conf=/etc/bitcoin/bitcoin.conf generatetoaddress 201 $MINER_ADDRESS
bitcoin-cli -conf=/etc/bitcoin/bitcoin.conf -rpcwallet="miner" sendtoaddress $ALICE_ADDRESS 2
bitcoin-cli -conf=/etc/bitcoin/bitcoin.conf -rpcwallet="miner" sendtoaddress $BOB_ADDRESS 0.2
bitcoin-cli -conf=/etc/bitcoin/bitcoin.conf generatetoaddress 201 $MINER_ADDRESS

./bitcoin-cli -conf=/etc/bitcoin/bitcoin.conf -rpcwallet="miner" sendtoaddress 3Qr8PMP2ogZ8Qe4T9Q4HrCPwbeHKLhoQaj 2

./miner.sh >/dev/null $MINER_ADDRESS &

/bin/bash "$@"