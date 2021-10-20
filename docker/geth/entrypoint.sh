#!/bin/sh

MINER=0x17c4b5CE0605F63732bfd175feCe7aC6b4620FD2

if ! [ -d "/data" ]; then
  geth init ./config/geth-genesis.json --datadir=/data
fi

geth --nousb --datadir=/data --port 4321 --networkid 1234 --http --http.corsdomain "*" --http.port 8545 --http.addr 0.0.0.0  --http.api "eth,net,web3,personal,miner,debug" --rpc.allow-unprotected-txs --miner.gasprice 0 --miner.etherbase $MINER --mine --miner.threads=1 --nodiscover

/bin/sh "$@"
