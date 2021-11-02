# FAQ

## How long does a bridge transfer take?

It will take around 5 ~ 10 minutes.

When moving assets from Ethereum to Nervos:
- You have to wait until the lock transaction confirmed on Ethereum. How long it takes depends on your gas price(or
  Max Priority Fee Per Gas after London Fork). It will be around 3 minutes for average fee.
- Force Bridge will wait for 12 Ethereum confirmed blocks for security. It will take around 2 minutes.
- When the lock transaction is confirmed with 12 blocks, the bridge committee will sign the cross chain transaction and
  send the transaction to Nervos Network. Typically it will take around 1 minute.
  
The process is basically the same when moving assets from Nervos back to Ethereum. The difference is to wait for 15
Nervos confirmed blocks instead of 12 Ethereum blocks. 
When gas price become too high, Force Bridge might wait until it get back to normal price.  

## How do fees work on Force Bridge?

The bridge charges cross chain fees in order to cover the cost of the transaction fees on the Nervos and Ethereum
networks, as well as the operational costs of the bridge infrastructure. These fees are charged in-kind with the
asset being transferred. That is, when you transfer a token, a portion of the balance transferred goes towards covering
the fee. You can see the bridge fee on the UI when you transfer.

When moving assets from Ethereum to Nervos, the bridge fee is 400 CKBytes worth of the asset being transferred.
When you finished transferring from Ethereum to Nervos, you will get 400 CKBytes along with the mirror token you
transferred every time. The CKB you get can be used as the capacity of your token, as well as transaction fees on Nervos Network
later. E.g. you can deposit your mirror token to Godwoken(the EVM compatible layer 2 on Nervos), transfer your token to
other addresses.

When moving assets from Nervos back to Ethereum, the bridge fee is largely based on the expected Ethereum transaction
fee. For now it is 0.015 ETH worth of the asset being transferred, which is 150000 gas * 100 Gwei gas price.
It might be adjusted according to the average gas price.

## What is the Bridge's address on Ethereum?

- Testnet(Rinkeby): [0x0670009f6126e57c679e90aee46861d28da2f703](https://rinkeby.etherscan.io/address/0x0670009f6126e57c679e90aee46861d28da2f703)
- Mainnet: [0x63a993502e74828ddba5710327afc6dc78d661b2](https://etherscan.io/address/0x63a993502e74828ddba5710327afc6dc78d661b2)

## Fail to Install `@force-bridge/cli`

```
5459 error node-pre-gyp http 404 https://github.com/nervosnetwork/lumos/releases/download/v0.16.0/lumos-indexer-node-v93-linux-x64.tar.gz
```

One dependency of forcecli does not support Node.js 16.x yet. Recommend to use Node.js 12.x. 
