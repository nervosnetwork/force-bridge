# Force Bridge Data Structure

## CKB

### Mint Tx

```
- cell_deps
  - bridge lockscript
  - multiple signature
  - sudt
- inputs
    - bridge cell 1
        - type: null
        - lock
            - args
                - owner lock hash
                - chain type
                - asset type
            - code: bridge lockscript
    - bridge cell 2
    - ...
    - unlock cell
        - type: null
        - lock: multisig lockscript
- outputs
    - sudt cell 1
        - type:
            - args: bridge lockscript hash
            - code: sudt typescript
        - lock
    - sudt cell 2
    ...
- witnesses
  - mint ids for the bridge cell 1
  - mint ids for the bridge cell 2
  ...
  - signature of unlock cell
```

- Unlock cell lockscript hash should be the same with owner lock hash of bridge cell. It means one cell to supply
  capacity can also represents the owner ship of bridge lockscript.
- The args of bridge lockscript is unique for every asset on every chain. So the associated SUDT is different.
- We can use one bridge cell to relay multiple cross chain transactions. We put the mint ids(the unique identity of a 
  mint event) in the witness to show the relationship between lock event in xchain and mint event in CKB.
  
#### bridge lockscript args

- eth
  - chain_type: 1u8
  - asset type: [u8; 20]
    - '0x00000000000000000000' represents ETH 
    - other address represents ERC20 address
  
### Burn Tx

```
- cell_deps
  - sudt
- inputs   
  - sudt input cell
- outputs
  - recipient data cell
    - bridge lockscript code hash
    - bridge lockscript hash type
    - chain type
    - asset type
    - amount
    - memo
  - sudt output cell
- witnesses
```

#### memo

- eth
  - recipient address