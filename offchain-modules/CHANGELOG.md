## v0.0.29 (2022-3-25)

- [fix eth lock table row too long](https://github.com/nervosnetwork/force-bridge/pull/339)

## v0.0.28 (2022-3-24)

## v0.0.27 (2022-3-24)

## v0.0.26 (2022-3-23)

### Features

- [adjust eth rpc timeout](https://github.com/nervosnetwork/force-bridge/pull/331)

## v0.0.25 (2022-2-25)

### Features

- [monitor the native and mirror token total balance](https://github.com/nervosnetwork/force-bridge/pull/323)

## v0.0.24 (2022-1-30)

### Features

- [replace pw-lock with omni-lock](https://github.com/nervosnetwork/force-bridge/pull/310)

## v0.0.23 (2022-1-28)

### Bug fixes

- [handle bsc node network jitter](https://github.com/nervosnetwork/force-bridge/pull/309)

## v0.0.21 (2022-1-27)

### Bug fixes

- [fix send unlock tx failed in case of low gas price](https://github.com/nervosnetwork/force-bridge/pull/306)
- [fix bsc monitor log](https://github.com/nervosnetwork/force-bridge/pull/307)

## v0.0.20 (2022-1-21)

### Bug fixes

- [fix capacity insuffient error msg](https://github.com/nervosnetwork/force-bridge/pull/298)

### Features

- [adjust asset white list](https://github.com/nervosnetwork/force-bridge/pull/299)
- [adjust bridge fee](https://github.com/nervosnetwork/force-bridge/pull/300)

## v0.0.19 (2022-1-12)

### Bug fixes

- [fix multisig cell conflict](https://github.com/nervosnetwork/force-bridge/pull/290)

## v0.0.18 (2022-1-7)

### Features

- [add bsc asset white list](https://github.com/nervosnetwork/force-bridge/pull/284)
- [check ethereum address of config](https://github.com/nervosnetwork/force-bridge/pull/288)

## v0.0.17 (2021-12-24)

### Features

- [bsc compatability support](https://github.com/nervosnetwork/force-bridge/pull/269)

## v0.0.16 (2021-12-20)

### Bug fixes

- [Fix version api of verifiers](https://github.com/nervosnetwork/force-bridge/pull/260)
- [Better hint of CKB insufficient error message](https://github.com/nervosnetwork/force-bridge/pull/262)

## v0.0.15 (2021-12-03)

### Features

- [CKB2021 address](https://github.com/nervosnetwork/rfcs/pull/239) format compatibility.
- Readonly mode for watchers. We can seperate the read and write nodes for watchers, thus scale the read nodes to
  handle more requests.
- Cross chain assets monitor and audit.
