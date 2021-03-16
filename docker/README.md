# CKB dev-chain

### 1. docker build
```shell script
cd docker/ckb
docker build -t ckb-dev:v0.36.0 . 
```
### 2. docker run
```shell script
docker run --rm -it -p 8114:8114 ckb-dev:v0.36.0
```

# CKB indexer

### 1. docker build
```shell script
cd docker/ckb-indexer
docker build -t ckb-indexer . 
```
### 2. docker run
```shell script
docker run --rm -it -p 8116:8116 ckb-indexer
```

# Geth private chain

### 1. docker build
```shell script
cd docker/geth
docker build -t geth-priv:v1.9.23 . 
```
### 2. docker run

The first time you run container, it will take 5~10 minutes for geth to be ready because of generating dag.

We use docker volume `geth-dag` to store dag data, so the geth will be ready very soon the next time you run container. 

```shell script
# cd docker/geth
docker run --rm -it --mount type=bind,source="$(pwd)",target=/config --mount source=geth-dag,target=/root/.ethash -p 8545:8545 geth-priv:v1.9.23
```

The privkey of accounts in geth-genesis.json for tests:

| pubkey | privkey |
| :----: | :-----: |
| 0x17c4b5CE0605F63732bfd175feCe7aC6b4620FD2 | 0xc4ad657963930fbff2e9de3404b30a4e21432c89952ed430b56bf802945ed37a |
| 0x8951a3DdEf2bB36fF3846C3B6968812C269f4561 | 0x719e94ec5d2ecef67b5878503ffd6e1e0e2fe7a52ddd55c436878cb4d52d376d |
| 0x42e8763917A72e07369AD54B158b0FA839f060bc | 0x627ed509aa9ef55858d01453c62f44287f639a4fa5a444af150f333b6010a3b6 |
| 0xE61438B717b6937388bf66D256395A15B3D169aE | 0x49e7074797d83cbb93b23877f99a8cecd6f79181f1236f095671017b2edc64c2 |
| 0xB7ABd784a77c307797844136eB2F2A67325E2486 | 0x6e51216cbb2fe170368da49e82b22f02b999204730c858482d0e84a9083005ac |

# Docker compose

```shell script
cd docker
# start up
docker-compose up
# stop and remove containers
docker-compose down
```
