#!/bin/sh

MINER=0x17c4b5CE0605F63732bfd175feCe7aC6b4620FD2

if ! [ -d "/data" ]; then
  geth init ./config/geth-genesis.json --datadir=/data
fi

geth --nousb --datadir=/data --port 4321 --networkid 1234 --rpc --rpccorsdomain "*" --rpcport 8545 --rpcaddr 0.0.0.0  --rpcapi "eth,net,web3,personal,miner,debug" --gasprice 0 --etherbase $MINER --mine --miner.threads=1 --nodiscover

/bin/sh "$@"
