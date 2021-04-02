# Force Bridge 简介

- [Force Bridge 简介](#force-bridge-简介)
  - [架构设计](#架构设计)
  - [组件详细说明](#组件详细说明)
    - [CKB 合约](#ckb-合约)
      - [bridge lockscript](#bridge-lockscript)
      - [recipient typescript](#recipient-typescript)
    - [以太坊合约 ForceBridge.sol](#以太坊合约-forcebridgesol)
    - [offchain modules](#offchain-modules)
  - [本地运行](#本地运行)

> 本简介基于 tag [`audit-v1.0`](https://github.com/nervosnetwork/force-bridge/tree/audit-v1.0)。

Force Bridge 是一个连接 CKB 和其它公链的通用多签见证跨链桥。

Force Bridge 的跨链流程概述（以 BTC 为例）：
- 从 BTC 跨到 CKB
    - 多签 committee 在 BTC 上生成多签地址并公开
    - 用户在 BTC 上将资产转给 committee 的多签地址，并使用 OP_RETURN Output 附加一段数据，指定 CKB 接收地址等额外信息
    - committee 监听 BTC，观察到该类交易后，在 CKB 上给用户 mint 对应的影子资产（ckBTC）
- 从 CKB 跨回 BTC
    - 用户在 CKB 上烧毁影子资产，并在 output data 里附加上一段数据，指定 BTC 的接收地址
    - committee 在 BTC 上构造交易，将对应的金额转给 BTC 接收地址

只要某条链上的某种资产支持多签转账，并可以附加额外的数据，则可以实现对应的组件，将该链接入 Force Bridge。目前已经支持的链和资产包括：
- Bitcoin: BTC
- Ethereum: ETH 和 ERC20 token
- TRON: TRX、TRC10 和 TRC20
- EOS: 所有 eosio.token，包括 EOS

## 架构设计

- 合约
    - ckb
        - bridge lockscript
        - recipient typescript
    - eth
        - ForceBridge.sol
- 链下模块
    - ckb handler
    - xchain handler
        - eth
        - btc
        - eos
        - tron

## 组件详细说明

### CKB 合约

所有 CKB 合约位于文件夹 [ckb-contracts](https://github.com/nervosnetwork/force-bridge/tree/audit-v1.0/ckb-contracts) 下。

#### bridge lockscript

合约入口为 `ckb-contracts/contracts/bridge-lockscript/src/main.rs`，但入口仅有简单封装，为 target 到 riscv 的 rust bin 项目。主要逻辑在 `ckb-contracts/lib/bridge-lockscript-lib/src/lib.rs` 下，是支持 x86 下编译的 rust lib 库。可以在 ckb-contracts 下执行单元测试。所有 ckb 合约均采用此项目组织方式。

CKB 的 [sudt](https://talk.nervos.org/t/rfc-simple-udt-draft-spec/4333) 协议使用一个 lockscript hash 作为 owner 发行资产。不同 lockscript 映射到不同的 sudt 资产。bridge lockscript 即充当此处的资产 owner 作用。

一个简化的 mint 交易结构如下：

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
    - unlock cell
        - type: null
        - lock: multisig lockscript
- outputs
    - sudt cell
        - data
            - amount
            - sudt extra data
        - type:
            - args: bridge lockscript hash
            - code: sudt typescript
        - lock
- witnesses
  - mint ids for the bridge cell
  - signature of unlock cell
```

所有 bridge lockscript 代码相同，但 args 不同，其组成包括：
- owner lock hash
- chain type
- asset type

bridge lockscript 的代码会检查 input 中有 lockscript hash 和 args 中的 owner lock hash 相同。原理与 sudt 类似。owner lock hash 即为 committee 的多签 lockscript hash，通过校验 input 有被解锁的多签 lockscript，证明该 bridge lockscript 可以被合法解锁，进而可以 mint sudt 资产。

chain type 和 asset type 对应不同链的不同资产，通过这两个参数，可以用同一个 script 脚本为不同链不同资产创建影子资产。

#### recipient typescript

用来校验 output data 中填入的数据合法（用户确实销毁了一定数量的 sudt），committee 仅需观察链上交易是否包含此类 output 并解析 output data 即可构造解锁交易。

一个简化的 burn 交易：

```
- cell_deps
  - sudt code
- inputs
  - sudt input cell
- outputs
  - recipient data cell
      - data
      - type
          - recipient typescript
  - sudt output cell
- witnesses
```

recipient cell data schema:

```
table RecipientCellData {
    recipient_address: Bytes,
    chain: byte,
    asset: Bytes,
    bridge_lock_code_hash: Byte32,
    owner_lock_hash: Byte32,
    amount: Uint128,
    fee: Uint128,
}
```

该 typescript 代码会做如下校验:
- 计算 burn 掉的 sudt 数量，填入 amount
- 用户任意指定 recipient_address 和 fee
- 验证其它字段与 mint 该 sudt 的 bridge lockscript 相符

有这些校验后，committee 仅需监听链上 output 中包含 recipient typescript 的交易，并根据解析出来的 RecipientCellData 进行筛选（例如只选出 owner_lock_hash 是自己 committee 多签 lockscript hash 的）。

### 以太坊合约 ForceBridge.sol

以太坊没有原生多签地址，使用合约接收用户锁定的资产，提供 committee 多签签名解锁资产。

合约地址为：<https://github.com/nervosnetwork/force-bridge/blob/audit-v1.0/eth-contracts/contracts/ForceBridge.sol>。

主要接口说明：

```solidity
function lockETH(
    bytes memory recipientLockscript,
    bytes memory sudtExtraData
) public payable;

function lockToken(
    address token,
    uint256 amount,
    bytes memory recipientLockscript,
    bytes memory sudtExtraData
) public;

event Locked(
    address indexed token,
    address indexed sender,
    uint256 lockedAmount,
    bytes recipientLockscript,
    bytes sudtExtraData
);
```

用户锁定 ETH 或 ERC20 资产到合约，并指定 `recipientLockscript` 和 `sudtExtraData`，合约 emit `Locked` 事件。committee 监听该事件，去 CKB 上 mint 对应数量的 sudt 给地址 `recipientLockscript`，并在 sudt 的扩展字段中，加入 `sudtExtraData`。

```solidity
struct UnlockRecord {
    address token;
    address recipient;
    uint256 amount;
    bytes ckbTxHash;
}

function unlock(UnlockRecord[] calldata records, bytes calldata signatures) public;
```

committee 在 CKB 观察到 burn ETH 影子资产的行为后，构造 `unlock` 交易，将对应的资产解锁，转给指定的接收地址。`signature` 为 committee 的多签签名。


### offchain modules

offchain modules 组织结构及说明如下

```
src
├── apps
│   ├── cli             # 用户用来和 force bridge 交互的 cli 工具
│   ├── relayer         # committee 运行的 relayer 进程
│   └── server          # 对外提供 UI 用的后端服务
├── packages
│   ├── ckb             # ckb handler
│   ├── config.ts
│   ├── core.ts
│   ├── db
│   ├── handlers
│   ├── index.ts
│   ├── utils
│   └── xchain          # 所有支持的链的工具模块
│       ├── btc
│       ├── eos
│       ├── eth
│       └── tron
└── scripts
    └── integration-test
```

## 本地运行

安装依赖
- docker
- rust
- capsule: `cargo install capsule --git https://github.com/nervosnetwork/capsule.git --tag v0.2.3`

测试合约
- 测试 ckb contracts: `cd ckb-contracts && make test-contract`
- 测试 eth contracts: `cd eth-contracts && yarn test`

跑集成测试

```
make local-ci
```

本地起服务

```
cd offchain-modules
yarn start
```