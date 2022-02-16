# Asset Migration Guide

There are two existing wallets on Nervos Network Mainnet to enable users to use Ethereum wallets as Nervos wallets: [omni-lock](https://github.com/XuJiandong/docs-bank/blob/master/omni_lock.md) and [pw-lock](https://github.com/lay2dev/pw-lock).

For historical reason, Yokaiswap uses omni-lock and Force Bridge uses pw-lock.

If both Yokai Wallet and Force Bridge are connected to the same Ethereum account, the relevant Nervos address can be found as below.

https://www.yokaiswap.com/

![img.png](assets/asset-migration-5.png)

https://forcebridge.com/bridge/Nervos/Ethereum

![img_1.png](assets/asset-migration-6.png)

On the Nervos network, there is no PW-lock UI to manipulate SUDT. Users who have mirrored assets (e.g. ETH|eth, BNB|bsc) in PW-lock cannot transfer assets to Yokaiswap again. Instead, users have to bridge the assets to Ethereum and back again, which causes a significant transaction fee loss. Worse still, the assets may get stuck in the Force Bridge address if there is insufficient equity to cover the cross-chain fees.

To solve the problems, Force Bridge is planning to switch the wallet from pw-lock to omni-lock. When completed, Yokai L1 wallet and Force Bridge wallet will be the same.

A tool is provided to help users migrate assets in PW-lock to omni-lock.

- The migration tool UI: <https://pw-up.vercel.app/>
- Source Code: <https://github.com/homura/pw-up>

> WARNING: This tool is provided by the community, **USE IT AT YOUR OWN RISK**. It's recommended to test with some small asset first.

## Migration Guide

visit <https://pw-up.vercel.app/>

![img.png](assets/asset-migration-1.png)

Connect to Metamask. Select the LINA network, check the assets in the wallet for possible migration. Click Transfer when the migration is confirmed.

![img_1.png](assets/asset-migration-2.png)

If this error appears, fund the `from address` with enough CKBs.
Transfer from a CKB wallet or exchange wallet to the `from address`.

> **Note:** Some wallets or exchanges may not support this kind of CKB address, it's recommended to use imToken or Binance.

![img_2.png](assets/asset-migration-3.png)

The transaction hash is available under the "Transfer" button if all proceeds well. Click to check it on Nervos Explorer.

![img_3.png](assets/asset-migration-4.png)

After the transaction is confirmed, the assets will be available for viewing on Yokaiswap as well.

![img_2.png](assets/asset-migration-7.png)

This tool only migrates all the SUDT assets. To transfer the remaining CKBs in PW-lock, use the [PW-wallet UI](https://ckb.pw/#/).
