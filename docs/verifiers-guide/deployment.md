# Deployment Guide For Verifiers

In Force Bridge, the assets of users are guarded by the multi-signature of the committee. So every cross-chain transaction
will be signed by the committee to take effect on the counter-party chain.

There will be two roles in the architecture, **collector** and **verifier**.
The **collector** will watch the Ethereum chain, compose mint transactions on CKB when it sees newly confirmed lock transactions on
Ethereum, send the raw transaction to all verifiers to collect their signatures.
**Verifiers** will watch both chains, verify the sign request sent by the collector, provide their signature if it is a legal
cross-chain transaction.
When the collector gets signatures more than multi-signature threshold, it will send the transaction to CKB Chain.
The process is similar to compose unlock transactions on Ethereum when it sees newly confirmed burn transactions on CKB.

So all the verifiers have to run a service to watch Ethereum and CKB chain, verify the sign request and provide
signatures. This documentation is a deployment guide for the service.

## Dependencies

Install dependencies below.

- Node.js. The verifier process is a Node.js process. It's recommended to use Node.js 14.x version.
- MySQL. Used to store data for the service. Recommended version is 5.7. It's better to use cloud database
  service for more features.
- Docker. Used to run CKB full node and indexer.
- CKB RPC and indexer endpoint. It's recommended to run a full node via docker locally.
- Ethereum RPC endpoint. It's recommended to use [infura](https://infura.io/dashboard/ethereum) or alchemy service.

```bash
# install forcecli
$ npm install -g @force-bridge/cli@latest

# check if it works
$ forcecli -h
Usage: forcecli [options] [command]

forcecli is command line tool to lock & unlock asset to force bridge

Options:
  -V, --version        output the version number
  -h, --help           display help for command

Commands:
  eth
  collector [options]
  fee                  query and withdraw bridge fee
  rpc [options]
  verifier [options]
  config
  keystore
  help [command]       display help for command


# run CKB full node and indexer
# reference: <https://hub.docker.com/r/nervos/perkins-tent>
# you can change the port and mount directory as you want.
$ docker run -d -it -p 8117:9115  --name=ckb-testnet-indexer  -e "CKB_NETWORK=testnet" -v /path/to/ckb/data:/data nervos/perkins-tent:v0.43.0

# check if it works
echo '{
    "id": 2,
    "jsonrpc": "2.0",
    "method": "get_blockchain_info",
    "params": []
}' \
| tr -d '\n' \
| curl -H 'content-type: application/json' -d @- \
http://localhost:8117/rpc

echo '{
    "id": 2,
    "jsonrpc": "2.0",
    "method": "get_cells",
    "params": [
        {
            "script": {
                "code_hash": "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8",
                "hash_type": "type",
                "args": "0x8211f1b938a107cd53b6302cc752a6fc3965638d"
            },
            "script_type": "lock"
        },
        "asc",
        "0x64"
    ]
}' \
| tr -d '\n' \
| curl -H 'content-type: application/json' -d @- \
http://localhost:8117/indexer
```

## Generate Private Key and Associated Configs

Generate your own private key. The private key is used to sign the cross-chain transactions, keep them **SAFE**.

```bash
# generate the multiConfig
$ export PRIVKEY=0x1000000000000000000000000000000000000000000000000000000000000000
$ forcecli config generate -k $PRIVKEY -p ckb
multiConfig:
{
  "ethAddress": "0x7B2419E0Ee0BD034F7Bf24874C12512AcAC6e21C",
  "ckbPubkeyHash": "0x42a34b11710e40b97180f8edae2760c0ab69bcf3",
  "ckbAddress": "ckt1qyqy9g6tz9csus9ewxq03mdwyasvp2mfhnesju9rhz"
}
# Send the multiConfig to the collector, it will be used in the deployment of on-chain contracts. 


# generate keystore
$ echo "{\"verifier\":\"${PRIVKEY}\"}" > keys.json
$ forcecli keystore encrypt -s ./keys.json -d ./keystore.json -p my-custom-password
# 1. Save the keystore.json file and remember your password.
# 2. Delete the keys.json file, close the terminal and clear the shell commands history to keep your private key safe.
```

## Run Verifier Service

When we gets the multisig config from all verifiers, we will deploy the contracts, and then send verifiers a service
config like this:

<https://github.com/nervosnetwork/force-bridge/blob/main/offchain-modules/config.json.example>

Put it on your machine, and edit it according to your own environment.
Pay attention to the fields below:

| field      | description |
|------------|-------------|
| common.log | change the log level and logFile path as you wish |
| common.orm | create a new database and user for force bridge in your Mysql, then change the username, password and database in your config |  
| common.keystorePath | set it to your keystore path |
| common.port | the listen port of your service, should be `80` by default |
| eth.rpcUrl | your infura service endpoint |
| eth.privateKey | the key of your private key in keystore. If you follow the previous steps, it will be `force-bridge` |
| ckb.ckbRpcUrl | the ckb RPC endpoint, if you follow the previous steps, it will be `http://localhost:8117/rpc` |
| ckb.ckbIndexerUrl | the ckb indexer endpoint, if you follow the previous steps, it will be `http://localhost:8117/indexer` |
| ckb.privateKey | the key of your private key in keystore. If you follow the previous steps, it will be `force-bridge` |

Run verifier service:

```bash
# start verifier service
$ forcecli verifier --config /path/to/your/config.json

# check if it works
$ echo '{ "id": 0, "jsonrpc": "2.0", "method": "status" }' \
| curl -H 'content-type: application/json' -d @- \
http://127.0.0.1:80/force-bridge/sign-server/api/v1
{
    "id": 0,
    "jsonrpc": "2.0",
    "result": {
        "addressConfig": {
            "ckbAddress": "ckt1qyqx9424gr3p237a36lt8veh50gaavc27jpqmhrdum",
            "ckbPubkeyHash": "0x62d55540e21547dd8ebeb3b337a3d1deb30af482",
            "ethAddress": "0x994B430359BEDCfeb73EB90Fb39416A7dE1F1640"
        },
        "latestChainStatus": {
            "ckb": {
                "latestCkbBlockHash": "0x95e1f7331c7a5a41ef24a8fbecc2ff10d2319fa678479d2345c8b8ebc04f9868",
                "latestCkbHeight": "1417"
            },
            "eth": {
                "latestEthBlockHash": "0xea3470c3ba5f26c4d049e9796940bb973258992d149e0f708774bac1b3182b7b",
                "latestEthHeight": "1180"
            }
        }
    }
}
```

You can use your own process manager(systemd, [pm2](https://pm2.keymetrics.io/), [supervisor](https://github.com/petruisfan/node-supervisor), etc) to restart it when the process exits accidentally.

## Other Configs

- NGINX. It's recommended to use NGINX as reverse proxy for the RPC service. We should always enable `ssl` parameter
to make the RPC service to be accessed by HTTPS for better security.
- Firewall. The verifier machine should use strict firewall configuration which only allow specific IPs to connect.

If you run into any problem, feel free to [open an issue](https://github.com/nervosnetwork/force-bridge/issues/new).
