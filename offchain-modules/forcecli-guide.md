#Forcecli guide

##1 Install

```bash
git clone https://github.com/nervosnetwork/force-bridge.git

cd offchain-modules
yarn install
yarn build

cp config-cli.json.example config-cli.json
# edit the config file on your demands
npm link
```

##2 Get help for forcecli

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
  btc
  help [command]  display help for command
```

##3 How to lock asset

**1 Query balance.**

Eth balance on ethereum

```bash
forcecli eth balanceOf -addr 0x8951a3DdEf2bB36fF3846C3B6968812C269f4561 -o
```

- -addr, --address address on eth or ckb
- -s, --asset contract address of asset (default: "0x0000000000000000000000000000000000000000")
- -o, --origin whether query balance on eth

If you want query erc20 token's balance, please use -s flag to specific token address.

Eth balance on CKB

```bash
forcecli eth balanceOf -addr ckt1qyqyph8v9mclls35p6snlaxajeca97tc062sa5gahk
```

**2 Lock asset**

```bash
forcecli eth lock -p 0x719e94ec5d2ecef67b5878503ffd6e1e0e2fe7a52ddd55c436878cb4d52d376d -r ckt1qyqyph8v9mclls35p6snlaxajeca97tc062sa5gahk -a 0.1
```

- -p, --privateKey private key of locked account
- -a, --amount amount to lock
- -r, --recipient recipient address on ckb
- -s, --asset contract address of asset (default: "0x0000000000000000000000000000000000000000")
- -w, --wait whether wait for transaction confirmed
- -e, --extra extra data of sudt

If you want lock erc20 asset, please use -s flag, to specific erc20 token address.

**3 Query balance**

Eth balance on CKB

```bash
 forcecli eth balanceOf -addr ckt1qyqyph8v9mclls35p6snlaxajeca97tc062sa5gahk
```

Eth balance on ethereum

```bash
forcecli eth balanceOf -addr 0x8951a3DdEf2bB36fF3846C3B6968812C269f4561 -o
```

##4 How to unlock asset

**1 Query balance.**

Eth balance on ethereum

```bash
forcecli eth balanceOf -addr 0x8951a3DdEf2bB36fF3846C3B6968812C269f4561 -o
```

- -addr, --address address on eth or ckb
- -s, --asset contract address of asset (default: "0x0000000000000000000000000000000000000000")
- -o, --origin whether query balance on eth

If you want query erc20 token's balance, please use -s flag to specific token address.

Eth balance on CKB

```bash
forcecli eth balanceOf -addr ckt1qyqyph8v9mclls35p6snlaxajeca97tc062sa5gahk
```

**2 Unlock asset**

```bash
forcecli eth unlock -p 0xa800c82df5461756ae99b5c6677d019c98cc98c7786b80d7b2e77256e46ea1fe -r 0x8951a3DdEf2bB36fF3846C3B6968812C269f4561 -a 0.1
```

- -r, --recipient recipient address on eth
- -p, --privateKey private key of unlock address on ckb
- -a, --amount amount of unlock
- -s, --asset contract address of asset (default: "0x0000000000000000000000000000000000000000")
- -w, --wait whether wait for transaction confirmed

If you want to unlock erc20 asset, please use -s flag to specific token address.

**3 Query balance**

Eth balance on ethereum

```bash
 forcecli eth balanceOf -addr ckt1qyqyph8v9mclls35p6snlaxajeca97tc062sa5gahk
```

Eth balance on ethereum

```bash
forcecli eth balanceOf -addr 0x8951a3DdEf2bB36fF3846C3B6968812C269f4561 -o
```
