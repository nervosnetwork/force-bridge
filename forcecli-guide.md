#Forcecli guide

##1  Install
```bash
git clone https://github.com/nervosnetwork/force-bridge.git

cd offchain-modules
yarn install
yarn build

cp config-cli.json.example config-cli.json
# edit the config file on your demands
npm link
```

##2  Get help for forcecli
```bash
forcecli --help

Usage: forcecli [options] [command]

forcecli is command line tool to lock & unlock asset to force bridge

Options:
  -V, --version   output the version number
  -h, --help      display help for command

Commands:
  eth
  eos
  tron
  help [command]  display help for command
```

##3 How to lock asset

**1 Query balance.**

Eth balance on ethereum
```bash
forcecli eth balanceOf -addr 0x17c4b5CE0605F63732bfd175feCe7aC6b4620FD2
```
- -addr flag is eth address

Eth balance on CKB
```bash
 forcecli eth balanceOf -p 0xc4ad657963930fbff2e9de3404b30a4e21432c89952ed430b56bf802945ed37a
```
- -p flag is private key of address on ckb

**2 Lock asset**

```bash
forcecli eth lock -p 0xc4ad657963930fbff2e9de3404b30a4e21432c89952ed430b56bf802945ed37a -r ckt1qyqyph8v9mclls35p6snlaxajeca97tc062sa5gahk -a 0.1
```
- -p flag is private key of lock address on eth
- -r eth receive address on ckb
- -a amount to lock

**3 Query balance**

Eth balance on CKB
```bash
 forcecli eth balanceOf -p 0xc4ad657963930fbff2e9de3404b30a4e21432c89952ed430b56bf802945ed37a
```
- -p flag is private key of receive address on ckb

##4  How to unlock asset

**1 Query balance.**

Eth balance on ethereum
```bash
forcecli eth balanceOf -addr 0x17c4b5CE0605F63732bfd175feCe7aC6b4620FD2
```
- -addr flag is eth address

Eth balance on CKB
```bash
 forcecli eth balanceOf -p 0xc4ad657963930fbff2e9de3404b30a4e21432c89952ed430b56bf802945ed37a
```
- -p flag is private key of address on ckb

**2 Unlock asset**

```bash
forcecli eth unlock -p 0xa800c82df5461756ae99b5c6677d019c98cc98c7786b80d7b2e77256e46ea1fe -r 0x17c4b5CE0605F63732bfd175feCe7aC6b4620FD2 -a 0.1
```
- -p flag is private key of burn address on ckb
- -r eth receive address on eth
- -a amount to lock

**3 Query balance**

Eth balance on ethereum
```bash
forcecli eth balanceOf -addr 0x17c4b5CE0605F63732bfd175feCe7aC6b4620FD2
```
- -addr flag is eth address

Eth balance on CKB
```bash
 forcecli eth balanceOf -p 0xc4ad657963930fbff2e9de3404b30a4e21432c89952ed430b56bf802945ed37a
```
- -p flag is private key of address on ckb

##5 Forcecli config

测试网cli配置文件 config-cli.json
```javascript
{
  "forceBridge": {
    "eth": {
      "rpcUrl": "http://47.56.233.149:3045",
      "privateKey": "0xc4ad657963930fbff2e9de3404b30a4e21432c89952ed430b56bf802945ed37a",
      "multiSignThreshold": 2,
      "contractAddress": "0x0592Aa9Fd1CE50636C501e1e2db8688466acC1Ea"
    },
    "eos": {
      "rpcUrl": "https://jungle3.cryptolions.io:443",
      "chainId": "2a02a0053e5a8cf73a56ba0fda11e4d92e0238a4a2aa74fccf46d5a910746840",
      "bridgerAccount": "ericwang1112",
      "bridgerAccountPermission": "active",
      "latestGlobalActionSeq": -1,
      "onlyWatchIrreversibleBlock": false
    },
    "btc": {
      "clientParams": {
        "url": "http://47.56.233.149",
        "user": "test",
        "pass": "test",
        "port": 3043,
        "timeout": 10000
      },
      "lockAddress": "2N1VV17PQAQbNNicsoQhyUbiLciJwYLadfW"
    },
    "ckb": {
      "ckbRpcUrl": "http://47.56.233.149:3054",
      "ckbIndexerUrl": "http://47.56.233.149:3056",
      "deps": {
        "bridgeLock": {
          "cellDep": {
            "depType": "code",
            "outPoint": {
              "txHash": "0xbbcbb5355d4604731027358c7baf25e5d9b3d20ddce4308cd835794aa5c409e4",
              "index": "0x0"
            }
          },
          "script": {
            "codeHash": "0x8aa08e1154cbd2cb7dbb63f2a8b2f14c1fc7ec622f234e4ae6be37d757a4d106",
            "hashType": "data"
          }
        },
        "sudtType": {
          "cellDep": {
            "depType": "code",
            "outPoint": {
              "txHash": "0xbbcbb5355d4604731027358c7baf25e5d9b3d20ddce4308cd835794aa5c409e4",
              "index": "0x2"
            }
          },
          "script": {
            "codeHash": "0xe1e354d6d643ad42724d40967e334984534e0367405c5ae42a9d7d63d77df419",
            "hashType": "data"
          }
        },
        "recipientType": {
          "cellDep": {
            "depType": "code",
            "outPoint": {
              "txHash": "0xbbcbb5355d4604731027358c7baf25e5d9b3d20ddce4308cd835794aa5c409e4",
              "index": "0x3"
            }
          },
          "script": {
            "codeHash": "0xccfc7603253b4d495d09fb6813d0ad2504a12b650e8640878234552e9cd503ee",
            "hashType": "data"
          }
        }
      }
    },
    "tron": {
      "tronGridUrl": "https://nile.trongrid.io/",
      "committee": {
        "address": "TX3MGfWT5aGv81vTSdZtr6hbHxhMVh1FFM",
        "permissionId": 2
      },
      "feeLimit": 1000000
    }
  }
}

```
