# Force Bridge Introduction

Force Bridge is a general asset bridge between [CKB Chain](https://github.com/nervosnetwork/ckb)
and other chains.

It follows multi-signature notary scheme.
A trusted committee is involved in the cross chain process.
You can send your fungible token to the committee's multi-signature address on one chain (we will call it XChain in the
rest of this document),
along with extra data which indicates the recipient address on CKB.
The committee will watch XChain for the cross chain events and mint the mirror token on CKB.
You can burn the mirror token on CKB and get the original token back on XChain.

The chains and assets we have already supported:
- Bitcoin: BTC
- Ethereum: ETH and all ERC20 tokens
- TRON: TRX, all TRC10 and TRC20
- EOS: all `eosio.token`

As long as we can transfer the fungible asset between user and multi-signature address on one chain,
along with some additional data, we can implement the associated component in force bridge.
We may support more chains and assets by the user demands.

