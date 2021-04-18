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
 forcecli eth balanceOf -p 0xa800c82df5461756ae99b5c6677d019c98cc98c7786b80d7b2e77256e46ea1fe
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
 forcecli eth balanceOf -p 0xa800c82df5461756ae99b5c6677d019c98cc98c7786b80d7b2e77256e46ea1fe
```

- -p flag is private key of receive address on ckb

##4 How to unlock asset

**1 Query balance.**

Eth balance on ethereum

```bash
forcecli eth balanceOf -addr 0x17c4b5CE0605F63732bfd175feCe7aC6b4620FD2
```

- -addr flag is eth address

Eth balance on CKB

```bash
 forcecli eth balanceOf -p 0xa800c82df5461756ae99b5c6677d019c98cc98c7786b80d7b2e77256e46ea1fe
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
 forcecli eth balanceOf -p 0xa800c82df5461756ae99b5c6677d019c98cc98c7786b80d7b2e77256e46ea1fe
```

- -p flag is private key of address on ckb
