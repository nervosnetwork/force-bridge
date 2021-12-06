# Force Bridge

![integration-ci workflow](https://github.com/nervosnetwork/force-bridge/actions/workflows/integration-ci.yml/badge.svg)
[![codecov](https://codecov.io/gh/nervosnetwork/force-bridge/branch/main/graph/badge.svg)](https://codecov.io/gh/nervosnetwork/force-bridge)

> This project is still in active development.

A general new designed Force Bridge.

- It can connect to all chains which support multiple signature account and
  Non-fungible token transfer. We plan to support EOS, TRON, BTC, Cardano and Polkadot in the first stage.
- You have to trust the committee who runs the bridge.

## Quick Start

### Install Development Tools

- `docker`: https://docs.docker.com/get-docker/
- `docker-compose`: https://docs.docker.com/compose/install/
- `Node.js`: https://nodejs.org/en/
- `rust`(optional): https://www.rust-lang.org/learn/get-started

```bash
# install capsule with cargo
cargo install capsule --git https://github.com/nervosnetwork/capsule.git --tag v0.2.3
# or download the binary and put it in you PATH
# https://github.com/nervosnetwork/capsule/releases/v0.2.3

# run the integration test with docker
make local-ci

# run the bridge server manually
cd offchain-modules
yarn install
cp config.json.example config.json
# edit the config file on your demands
yarn start
```

### Install force-bridge cli

```bash
npm i -g @force-bridge/cli
```
