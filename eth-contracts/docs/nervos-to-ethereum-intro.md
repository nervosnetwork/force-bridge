# Nervos to Ethereum Cross Chain Contracts Description

This document describes the process to bridge Nervos assets to Ethereum with associated contracts.

We are using `lock-mint` pattern to bridge Nervos assets to Ethereum. When users lock their assets on Nervos chain,
we mint associated ERC20 tokens on Ethereum chain for them.

We'll support [CKB](https://www.coingecko.com/en/coins/nervos-network) and
[Simple UDT](https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0025-simple-udt/0025-simple-udt.md) for now.

## Process

### Global Initalization

1. Create a multisig wallet with [gnosis-safe](https://gnosis-safe.io/). It represents the Force Bridge Committee(FBC).
2. Deploy the `AssetManager` contract and set the owner to FBC.

### Asset Initalization

Before we can bridge a specific asset, we need to initialize the bridge contract.

1. Create the mirror token on Ethereum for the asset we want to bridge. We'll use the `NervosMirrorToken` contract by
default. If there are special functions for the asset, we can create a custom contract which implements the
`IMirrorToken` interface. For example, if we want to bridge `CKB` to Ethereum, we will deploy a new NervosMirrorToken
with the params `(name: "Nervos CKB", symbol: "CKB", decimals: 8)`.
2. Add the asset to `AssetManager`. The function signature we'll call is `function addAsset(address token, bytes32 assetId)`.
The `token` param is the address of the mirror token contract. The `assetId` param is the unique identifier of the asset
on Nervos chain. E.g. the `assetId` of an SUDT will be the typescript hash of the token.
3. Authorize the asset manager contract to mint and burn the mirror token. For the default `NervosMirrorToken` contract,
We can use `transferOwner` function to transfer ownership to FBC.

### Move Asset From Nervos to Ethereum

1. Users lock their assets on Nervos chain.
2. FBC mints the mirror token on Ethereum chain by calling `AssetManager.mint` function. The committee will monitor
Nervos chain and collect the signatures off-chain.

### Move Asset From Ethereum back to Nervos

1. Users burn their mirror token on Ethereum chain by calling `AssetManager.burn` function.
2. FBC unlock the associated assets on Nervos chain.

## Files

- contracts
  - `AssetManager.sol`: The main contract responsible for managing cross chain assets.
  - `IMirrorToken.sol`: The interface for Nervos mirror token contracts managed by asset manager.
  - `NervosMirrorToken.sol`: The default mirror token contract used for Nervos assets.
- test
  - `test_asset_manager.js`: Test cases for `AssetManager` contract. The `Nervos to Ethereum cross chain with multi signature admin`
    test case shows how we will do the process with gonosis-safe.
