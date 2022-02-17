# Use Docker For Local Development

## Devnet

Use docker to run the whole bridge, including CKB and Ethereum dev chain.

```bash
make build-ckb-contracts

cd offchain-modules
# start CKB dev chain and Ethereum dev chain
yarn startDevDockerDeps
# install dependencies and build via docker
yarn dev-docker:install
# deploy the contracts and generate all configs for you via docker
yarn dev-docker:generate
# generate the ui configs and build via docker
# if you don't need ui or start it yourself, skip it 
yarn dev-docker:generate-ui
# start off chain modules
yarn startDevDockers
# you can use 'yarn startDevDockersWithUi' instead of 'yarn startDevDockers' to run the whole bridge with ui
# open 'http://localhost:3003' in browser
# add a network named 'local' with rpc 'http://localhost:3000' and chainId '1234' to MetaMask
# import account with private key '0x6e51216cbb2fe170368da49e82b22f02b999204730c858482d0e84a9083005ac' to MetaMask for test
```

You can check the `devDocker.ts` file for more details.
Edit it on your demand.

## Testnet

You can deploy your own bridge version on Testnet and run Force Bridge nodes with docker. 

### Deploy Contracts and Run Force Bridge

```bash
mkdir -p workdir/testnet-docker

# edit workdir/testnet-docker/.env

cat workdir/testnet-docker/.env
ETH_RPC_URL = 'https://rinkeby.infura.io/v3/xxx'
CKB_RPC_URL = 'https://testnet.ckb.dev/rpc'
CKB_INDEXER_URL = 'https://testnet.ckb.dev/indexer'
CKB_PRIVATE_KEY = 'xxx'
ETH_PRIVATE_KEY = 'xxx'
```

Edit the `.env` with your own configs.
Your CKB_PRIVATE_KEY and ETH_PRIVATE_KEY should have CKB and ETH in the account to deploy the contracts.

You can use command `forcecli config generate -k $PRIVKEY` to get your associated CKB address and get CKB on [CKB faucet](https://faucet.nervos.org/).

The public CKB RPC address may be slow, you can use docker to run your own CKB full node.
Check <https://hub.docker.com/r/nervos/perkins-tent>.

Then, edit or create the `ckbDeps.json` in `workdir/testnet-docker`, add deployment info of the `sudtType`, `pwLock`, `omniLock`, `bridgeLock` and the `recipientType`.

For example (on testnet):

```javascript
{
  "sudtType": {
    "cellDep": {
      "depType": "code",
      "outPoint": {
        "txHash": "0xe12877ebd2c3c364dc46c5c992bcfaf4fee33fa13eebdf82c591fc9825aab769",
        "index": "0x0"
      }
    },
    "script": {
      "codeHash": "0xc5e5dcf215925f7ef4dfaf5f4b4f105bc321c02776d6e7d52a1db3fcd9d011a4",
      "hashType": "type"
    }
  },
  "pwLock": {
    "cellDep": {
      "depType": "code",
      "outPoint": {
        "txHash": "0x57a62003daeab9d54aa29b944fc3b451213a5ebdf2e232216a3cfed0dde61b38",
        "index": "0x0"
      }
    },
    "script": {
      "codeHash": "0x58c5f491aba6d61678b7cf7edf4910b1f5e00ec0cde2f42e0abb4fd9aff25a63",
      "hashType": "type"
    }
  },
  "bridgeLock": {
    "cellDep": {
      "depType": "code",
      "outPoint": {
        "txHash": "0x724fc9eb7131ba1f474469037a2de4a08ce56460adc137d352f01a945c6bfe9b",
        "index": "0x0"
      }
    },
    "script": {
      "codeHash": "0x0f46541631b1eeab075e8626487818180205a0a2a73e21e08da3f00055a2a310",
      "hashType": "type"
    }
  },
  "recipientType": {
    "cellDep": {
      "depType": "code",
      "outPoint": {
        "txHash": "0x724fc9eb7131ba1f474469037a2de4a08ce56460adc137d352f01a945c6bfe9b",
        "index": "0x1"
      }
    },
    "script": {
      "codeHash": "0x3e5d380f83e70519b6c9ef64aa05b885917486f569fb04f4b27282bc4ab21c71",
      "hashType": "type"
    }
  }
  "omniLock": {
    "cellDep": {
      "depType": "",
      "outPoint": {
        "txHash": "",
        "index": ""
      }
    },
    "script": {
      "codeHash": "",
      "hashType": ""
    }
  }
}
```

```bash
cd offchain-modules
# generate all configs
yarn testnet-docker:generate
# install and build force bridge inside docker
yarn testnet-docker:install
yarn startTestnet

# After then, you can use to test your testnet environment.
yarn testnet-docker:integration
```

### Run Force Bridge UI in Local Environment

```bash
git clone https://github.com/nervosnetwork/force-bridge-ui.git
cd force-bridge-ui

# edit apps/ui/.env.development
cat apps/ui/.env.development
REACT_APP_BRIDGE_RPC_URL=/api/force-bridge/api/v1
REACT_APP_BRIDGE_RPC_URL=http://127.0.0.1:4199/force-bridge/api/v1
REACT_APP_CKB_RPC_URL=https://testnet.ckb.dev/rpc

yarn install
# build commons libraries
yarn build:lib
yarn workspace @force-bridge/ui run start
```

When the ui starts, you can visit it to interact your own Force Bridge.
