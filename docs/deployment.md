# Force Bridge Deployment

This document is based on commit [b6ea811ac4c14b1e4119eca7d656710b22a738c6](https://github.com/nervosnetwork/force-bridge/tree/b6ea811ac4c14b1e4119eca7d656710b22a738c6).

There is an integration test in the GitHub Workflow. It uses docker to start CKB and Ethereum private chain, along with other dependencies(e.g. MySQL). It shows the whole process from building and deploying contracts to starting relayer services and running test cases.You can check the Makefile for more details.

## Collect the Committee Multisig Information

Since we need a committee to run Force Bridge, we have to know the addresses or public key hashes and the setting to initiate the contracts.

Let's take a 2 of 3 multisig committee as example. The config will be like below.

```
{
  "forceBridge": {
    "eth": {
      "multiSignAddresses": [
        "0xB026351cD0c62aC89e488A840b7205730E8476bd",
        "0x27EE444d5D96094EACecC00194b7026Eb4fD979c",
        "0x0C2207536768EcFFeB11744AdbCC90428a0EE83B"
      ],
      "multiSignThreshold": 2,
    },
    "ckb": {
      "multisigScript": {
        "R": 0,
        "M": 2,
        "publicKeyHashes": [
          "0x40dcec2ef1ffc2340ea13ff4dd9671d2f9787e95",
          "0xc8328aabcd9b9e8e64fbc566c4385c3bdeb219d7",
          "0xebf9befcd8396e88cab8fcb920ab149231658f4b"
        ]
      }
    }
  }
}
```

## Deploy Contracts

This will be done by Nervos Foundation.

### Ethereum

The Ethereum contract located at [eth-contracts/contracts/ForceBridge.sol](https://github.com/nervosnetwork/force-bridge/blob/b6ea811ac4/eth-contracts/contracts/ForceBridge.sol).

The signature of constructor is:

```
constructor(address[] memory validators, uint256 multisigThreshold)
```

We will use the configuration above the deploy the contract and get the bridge contract address.
You can refer the [deploy script](https://github.com/nervosnetwork/force-bridge/blob/b6ea811ac4/eth-contracts/scripts/deploy.js) for more details.

### CKB

There are two CKB contracts in Force Bridge, bridge lockscript and recipient typescript.

We have to build and deploy them on CKB. You can refer the [deploy ckb script](https://github.com/nervosnetwork/force-bridge/blob/b6ea811ac4/offchain-modules/packages/scripts/src/deploy_ckb.ts) for more details.

```
"bridgeLock": {
  "cellDep": {
    "depType": "code",
    "outPoint": {
      "txHash": "0xa971faeabb549897a0292552127442ab2957e339dfbd38fa05a32a62380bd9f4",
      "index": "0x0"
    }
  },
  "script": {
    "codeHash": "0xdf37272de30a650a360b7a0db8c417b14246416008c9d15b964b69050a3fa23e",
    "hashType": "data"
  }
}
```

We will need the outpoint and script information later.

### Owner Cell

We will need an owner cell on CKB to specify the bridge lockscript owner. It's a normal cell, whose typescript is a [TypeID](https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0022-transaction-structure/0022-transaction-structure.md#type-id) and lockscript is a [multisig lockscript](https://github.com/nervosnetwork/ckb-system-scripts/blob/master/c/secp256k1_blake160_multisig_all.c).

After create the cell, we will get the information below for later usage.

```
  "ownerCellTypescript": {
    "code_hash": "0x00000000000000000000000000000000000000000000000000545950455f4944",
    "hash_type": "type",
    "args": "0x9e299206e0924026cbc283a37de3908172dc68fdd6e96c403de11156b92527bd"
  },
  "multisigLockscript": {
    "code_hash": "0x5c5069eb0857efc65e1bca0c07df34c31663b3622fd3876c876320fc9634e2a8",
    "hash_type": "type",
    "args": "0x7ae4ef98cc4c3e46d359f380cd60c50e3412de5d"
  }
```

Refer the [script](https://github.com/nervosnetwork/force-bridge/blob/b6ea811ac4/offchain-modules/packages/x/src/ckb/tx-helper/multisig/deploy.ts) for more details.

## Run Relayer Services

All the committee members will run a relay service. There will be 2 roles, collector and verifier. All members will watch Ethereum and CKB chain for cross chain transactions. Once users moves their assets on one chain(lock asset on Ethereum or burn asset on CKB), the collector will be responsible for composing the cross chain transaction on the other chain(mint mapped token on CKB or unlock asset on Ethereum), collecting the signatures of verifiers and sending the transactions.

The service is a JavaScript process, the dependencies are:
- MySQL: the database we used.
- Ethereum endpoint: used to interact with Ethereum, you can either running a full node yourself or use the infura service.
- CKB endpoint and CKB-indexer endpoint: you have to run a CKB full node and an indexer yourself.

```bash
# Right now it still needs to clone the repo, build the scripts and run the service, we will publish the cli tool soon
git clone https://github.com/nervosnetwork/force-bridge.git
cd offchain-modules && yarn install && yarn build

# run collector service example
CONFIG_PATH=./packages/scripts/src/integration-test/config/collector.json npx ts-node ./packages/app-relayer/src/index.ts

# run verifier service example
CONFIG_PATH=./packages/scripts/src/integration-test/config/verifier1.json npx ts-node ./packages/app-multisign-server/src/index.ts --port 8090
```

You can refer [offchain-modules/packages/scripts/src/integration-test/config/collector.json](https://github.com/nervosnetwork/force-bridge/blob/main/offchain-modules/packages/scripts/src/integration-test/config/collector.json) to see the complete configuration.

Things verifiers have to do:
- Get the common configuration (e.g. the contracts address, confirm number and so on).
- Change the dynamic part(e.g. the endpoints, the MySQL configuration) themselves and use it to run the service with the command above.
- Expose the service and give the IP address and port to collector.

Once all committee members starting their service, the Force Bridge is live.

The users can start use it with the Force Bridge UI hosted by Nervos Foundation or dapp server running by themselves.

