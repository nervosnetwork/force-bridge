# Upgrade CKB Node Guide

The AGGRON4 Testnet had been upgraded to the hard fork version(greater than v0.100.0), so we have to upgrade the CKB
node for verifiers, as well as the force bridge service to support the hard fork.

Check list
- [ ] upgrade CKB node to version greater than v0.100.0
- [ ] upgrade `forcecli` to version v0.0.12 to support CKB 2021

## Upgrade with Docker

If you started you verifier with docker like [this](./deploy-with-docker.md), change your `docker-compose.yml` as below.


```diff
  ckb:
-    image: nervos/perkins-tent
+    image: nervos/perkins-tent:v0.101.0
    restart: always
    environment:
      CKB_NETWORK: testnet
    volumes:
      - ./ckb-data:/data
    ports:
      - 3091:9115
  verifier:
    image: node:14.18.1-bullseye
    restart: always
    environment:
      FORCE_BRIDGE_KEYSTORE_PASSWORD: 123456
    volumes:
      - ./force-bridge:/data
    ports:
      - 3092:80
    command: |
      sh -c '
-      yarn global add @force-bridge/cli@latest
+      yarn global add @force-bridge/cli@0.0.12
      forcecli verifier -cfg /data/force_bridge.json
      '
    depends_on:
      - db
      - ckb
```

Then rebuild the images and restart the service.

```bash
cd /path/to/docker/compose
docker-compose up -d
```

Check whether the service works with the following API. Make sure the `latestCkbHeight` increases.

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

## Upgrade Manually

Stop your verifier service and CKB Node.

Follow this [instruction](https://talk.nervos.org/t/ckb-v0-100-0-upgrade-guide/6212) to upgrade your CKB node.

Install the new version of `forcecli` as below and restart your verifier service.

```bash
yarn global add @force-bridge/cli@0.0.12
```
