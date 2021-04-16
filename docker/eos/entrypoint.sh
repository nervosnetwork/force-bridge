#!/bin/bash

nodeos --data-dir ./ --config-dir ./ --config config.ini --logconf ./logging.json --genesis-json ./genesis.json &

sleep 2

cleos wallet create -f wallet.txt
# import eosio key, 5KQwrPbwdL6PhXujxW37FSSQZ1JiwsST4cqQzDeyXtP79zkvFD3:EOS6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5GDW5CV
cleos wallet import --private-key 5KQwrPbwdL6PhXujxW37FSSQZ1JiwsST4cqQzDeyXtP79zkvFD3

# import test account key, 5KQG4541B1FtDC11gu3NrErWniqTaPHBpmikSztnX8m36sK5px5:EOS6DdTKJaPCkuePnRh55qE875hQUdt5yH47v9838cLAnYVUZtVBF
cleos wallet import --private-key 5KQG4541B1FtDC11gu3NrErWniqTaPHBpmikSztnX8m36sK5px5
# import test account key, 5KjR55Q7UJpRnUx8zBdNaUC4P2573BsNLJaMR9o9wrJryYYXWU2:EOS4z7R4woUWaU2srBqqJFcj7TLnig4X8LHnq7wvJkkNcM1dKnF4X
cleos wallet import --private-key 5KjR55Q7UJpRnUx8zBdNaUC4P2573BsNLJaMR9o9wrJryYYXWU2
# import test account key, 5JWwbQDZ5UHHX5bayx7ZXJ25xvqvuPLWF1MFyEGpspkxqRvetUk:EOS7toXHLnV4qDr9xqM9DudDffoVu9VEJGFpj77hNUg36Fsb5p39V
cleos wallet import --private-key 5JWwbQDZ5UHHX5bayx7ZXJ25xvqvuPLWF1MFyEGpspkxqRvetUk

cleos create account eosio eosio.bpay EOS6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5GDW5CV
cleos create account eosio eosio.msig EOS6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5GDW5CV
cleos create account eosio eosio.names EOS6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5GDW5CV
cleos create account eosio eosio.ram EOS6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5GDW5CV
cleos create account eosio eosio.ramfee EOS6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5GDW5CV
cleos create account eosio eosio.saving EOS6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5GDW5CV
cleos create account eosio eosio.stake EOS6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5GDW5CV
cleos create account eosio eosio.token EOS6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5GDW5CV
cleos create account eosio eosio.upay EOS6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5GDW5CV

# create common user
cleos create account eosio alice EOS6DdTKJaPCkuePnRh55qE875hQUdt5yH47v9838cLAnYVUZtVBF
# create bridge account
cleos create account eosio forcebridge1 EOS4z7R4woUWaU2srBqqJFcj7TLnig4X8LHnq7wvJkkNcM1dKnF4X
sleep 1
# set to multiKey permission
cleos set account permission forcebridge1 active '{"threshold": 2, "keys":[{"key":"EOS4z7R4woUWaU2srBqqJFcj7TLnig4X8LHnq7wvJkkNcM1dKnF4X","weight":1},{"key":"EOS6DdTKJaPCkuePnRh55qE875hQUdt5yH47v9838cLAnYVUZtVBF","weight":1},{"key":"EOS7toXHLnV4qDr9xqM9DudDffoVu9VEJGFpj77hNUg36Fsb5p39V","weight":1}],"accounts":[],"waits":[]}' owner

sleep 1
cleos set contract eosio.token /eosio.contracts/build/contracts/eosio.token eosio.token.wasm eosio.token.abi
sleep 1
cleos push action eosio.token create '["eosio", "1000000000.0000 EOS"]' -p eosio.token@active
sleep 1
cleos push action eosio.token issue '["eosio", "1000000000.0000 EOS", "memo"]' -p eosio@active
sleep 1
cleos push action eosio.token transfer '["eosio","alice","100000000.0000 EOS", "memo"]' -p eosio@active

#hold container for a year
sleep 31536000
