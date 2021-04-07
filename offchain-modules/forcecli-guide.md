#Forcecli guide

###1. Install

```bash
git clone https://github.com/nervosnetwork/force-bridge.git

cd offchain-modules
yarn install
yarn build

cp config.json.example config.json
# edit the config file on your demands
npm link
```

###2. Get help for forcecli
`bash forcecli --help `

```bash
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

###3. ETH

#### 3.1 lock eth

```bash
forcecli eth lock -h
Usage: forcecli eth lock [options]

lock asset on eth

Options:
  -p, --privateKey  private key of locked account
  -a, --amount      amount to lock
  -m, memo          memo of transaction (default: "0x01,0x02")
  -h, --help        display help for command
```

eg:
`bash forcecli eth lock -p 0xc4ad657963930fbff2e9de3404b30a4e21432c89952ed430b56bf802945ed37a -a 0.1 `
####3.2 unlock eth

```bash
forcecli eth unlock -h
Usage: forcecli eth unlock [options]

unlock asset on eth

Options:
  -addr, --address  address to unlocked
  -a, --amount      amount of unlock
  -h, --help        display help for command
```

eg:
`bash forcecli eth unlock -addr 0x17c4b5CE0605F63732bfd175feCe7aC6b4620FD2 -a 0.1 `
####3.3 get balance

```bash
forcecli eth balanceOf -h
Usage: forcecli eth balanceOf [options]

query balance of address on eth

Options:
  -addr, --address  address to unlocked
  -h, --help        display help for command
```

eg:
`bash forcecli eth balanceOf -addr 0x17c4b5CE0605F63732bfd175feCe7aC6b4620FD2 `
###4. EOS
####4.1 lock eos

```bash
forcecli eos lock -h
Usage: forcecli eos lock [options]

lock asset on eos

Options:
  -acc, --account   account to lock
  -p, --privateKey  private key of locked account
  -a, --amount      amount of lock
  -m, memo
  -h, --help        display help for command
```

eg:
`bash forcecli eos lock -acc spongebob111 -p 5KQ1LgoXrSLiUMS8HZp6rSuyyJP5i6jTi1KWbZNerQQLFeTrxac -a 0.0001 `
####4.2 unlock eos

```bash
forcecli eos unlock -h
Usage: forcecli eos unlock [options]

unlock asset on eos

Options:
  -acc, --account  account to unlocked
  -a, --amount     amount of unlock
  -h, --help       display help for command
```

eg:
`bash forcecli eos unlock -acc spongebob111 -a 0.0001 `
####4.3 get balance

```bash
forcecli eos balanceOf -h
Usage: forcecli eos balanceOf [options]

query balance of account

Options:
  -acc, --account  account to query
  -v, --detail     show detail information of balance
  -h, --help       display help for command
```

eg:
`bash forcecli eos balanceOf -acc spongebob111 `
###5. TRON
####5.1 lock

```bash
forcecli tron lock -h
Usage: forcecli tron lock [options]

lock asset on tron

Options:
  -p, --privateKey  private key of locked address
  -a, --amount      amount of lock
  -m, memo          memo of transaction
  -h, --help        display help for command
```

eg:
`bash forcecli tron lock -p AECC2FBC0BF175DDD04BD1BC3B64A13DB98738962A512544C89B50F5DDB7EBBD -a 1 `
####5.2 unlock

```bash
forcecli tron unlock -h
Usage: forcecli tron unlock [options]

unlock asset on tron

Options:
  -addr, --address  account to unlocked
  -a, --amount      quantity of unlock
  -h, --help        display help for command
```

eg:
`bash forcecli tron unlock -addr TS6VejPL8cQy6pA8eDGyusmmhCrXHRdJK6 -a 1 `
####5.3 get balance

```bash
forcecli tron balanceOf -h
Usage: forcecli tron balanceOf [options]

query balance of address on tron

Options:
  -addr, --address  account to query
  -h, --help        display help for command
```

eg:
`bash forcecli tron balanceOf -addr TS6VejPL8cQy6pA8eDGyusmmhCrXHRdJK6 `
