# Deploy verifier node with Docker

1. Install `docker` on your machine.
2. Generate the `keystore.json` file with the instructions [here](./deployment.md#generate-private-key-and-associated-configs).
3. Download the config templates.
    ```bash
    cd /path/to/your/node
    mkdir force-bridge
    cp /path/to/your/keystore.json force-bridge

    # you can also visit the URL below and paste the content to the file
    wget https://github.com/nervosnetwork/force-bridge/blob/main/devops/verifier-testnet-docker/docker-compose.yml
    wget https://github.com/nervosnetwork/force-bridge/blob/main/devops/verifier-testnet-docker/force-bridge/force_bridge.json -O force-bridge/force_bridge.json
    ```
1. Edit the config.
   - `docker-compose.yml`
     - Replace the `FORCE_BRIDGE_KEYSTORE_PASSWORD` to the password to your own keystore.
     - Change the ports mapped to your own host machine.
     - Change the `MYSQL_ROOT_PASSWORD` to your owne secure password.
   - `force-bridge/force_bridge.json`
     - Change `common.orm.password` if you changed the `MYSQL_ROOT_PASSWORD`.
     - Change `eth.rpcUrl` to your own infura or Ethereum full node endpoint.
     - Make sure `eth.privateKey` and `ckb.privateKey` are the same with the key in your keystore.
4. Run the service.
   ```bash
   docker-compose up -d
   ```
5. Check the log with `docker-compose logs -f`. If it's your first time running the service,
   you may have to wait hours for the Testnet full node to synchronize. It depends on your network and
   machine performance, since there are millions of blocks in AGGRON4 Testnet now.
   You can check the Force Bridge log only in the path `force-bridge/force_bridge.log`.
6. You can use the command below to test if your node is working.

```bash
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
