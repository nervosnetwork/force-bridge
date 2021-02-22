import { logger } from './utils/logger';
import PWCore, {
  EthProvider,
  ChainID,
  Address,
  Amount,
  AddressType,
  CellDep,
  DepType,
  OutPoint,
    Script,
  HashType
} from '@lay2/pw-core';
import { IndexerCollector } from './ckb/collectors/indexer-collector'
import { CkbDefaultProvider } from './ckb/providers/ckb-default-provider'

const ckb_rpc_url = 'http://127.0.0.1:8114'
const ckb_indexer_url = 'http://127.0.0.1:8116'
const PRI_KEY = process.env.PRI_KEY || '0xa800c82df5461756ae99b5c6677d019c98cc98c7786b80d7b2e77256e46ea1fe';


async function main() {
  logger.debug('start pw-core demo');
  const config = {
    daoType: {
      cellDep: new CellDep(
          DepType.code,
          new OutPoint(
              '0xa563884b3686078ec7e7677a5f86449b15cf2693f3c1241766c6996f206cc541',
              '0x2'
          )
      ),
      script: new Script(
          '0x82d76d1b75fe2fd9a27dfbaa65a039221a380d76c926f378d3f81cf3e7e13f2e',
          '0x',
          HashType.type
      ),
    },
    sudtType: {
      cellDep: new CellDep(
          DepType.code,
          new OutPoint(
              '0xc1b2ae129fad7465aaa9acc9785f842ba3e6e8b8051d899defa89f5508a77958',
              '0x0'
          )
      ),
      script: new Script(
          '0x48dbf59b4c7ee1547238021b4869bceedf4eea6b43772e5d66ef8865b6ae7212',
          '0x',
          HashType.data
      ),
    },
    defaultLock: {
      cellDep: new CellDep(
          DepType.depGroup,
          new OutPoint(
              '0xace5ea83c478bb866edf122ff862085789158f5cbff155b7bb5f13058555b708',
              '0x0'
          )
      ),
      script: new Script(
          '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8',
          '0x',
          HashType.type
      ),
    },
    multiSigLock: {
      cellDep: new CellDep(
          DepType.depGroup,
          new OutPoint(
              '0xace5ea83c478bb866edf122ff862085789158f5cbff155b7bb5f13058555b708',
              '0x1'
          )
      ),
      script: new Script(
          '0x5c5069eb0857efc65e1bca0c07df34c31663b3622fd3876c876320fc9634e2a8',
          '0x',
          HashType.type
      ),
    },
    pwLock: {
      cellDep: new CellDep(
          DepType.code,
          new OutPoint(
              '0x7822910729c566c0f8a3f4bb9aee721c5da2808f9a4688e909c0119b0ab820d7',
              '0x0'
          )
      ),
      script: new Script(
          '0xc9eb3097397836e4d5b8fabed3c0cddd14fefe483caf238ca2e3095a111add0b',
          '0x',
          HashType.type
      ),
    },
    acpLockList: [
      new Script(
          '0xc9eb3097397836e4d5b8fabed3c0cddd14fefe483caf238ca2e3095a111add0b',
          '0x',
          HashType.type
      ),
    ],
  }
  const pwcore = await new PWCore(ckb_rpc_url).init(
      new CkbDefaultProvider(PRI_KEY, ckb_rpc_url), // a built-in Provider for Ethereum env.
      new IndexerCollector(), // a custom Collector to retrive cells from cache server.
      null,
      config,
  );

  const txHash = await pwcore.send(
      new Address('0x26C5F390FF2033CbB44377361c63A3Dd2DE3121d', AddressType.eth),
      new Amount('100')
  );
  logger.debug('end pw-core demo');
}

main();
