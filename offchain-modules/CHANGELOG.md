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