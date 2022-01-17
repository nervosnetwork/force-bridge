import fs from 'fs';
import { CkbDeployManager, OwnerCellConfig } from '@force-bridge/x/dist/ckb/tx-helper/deploy';
import { initLumosConfig } from '@force-bridge/x/dist/ckb/tx-helper/init_lumos_config';
import { CkbDeps } from '@force-bridge/x/dist/config';
import {
  writeJsonToFile,
  genRandomHex,
  privateKeyToCkbAddress,
  privateKeyToCkbPubkeyHash,
} from '@force-bridge/x/dist/utils';
import { logger } from '@force-bridge/x/dist/utils/logger';
import * as utils from '@force-bridge/x/dist/xchain/ada/utils';
import CKB from '@nervosnetwork/ckb-sdk-core';
import { Seed } from 'cardano-wallet-js';
import * as lodash from 'lodash';
import { pathFromProjectRoot } from './index';
// import * as CardanoWasm from '@emurgo/cardano-serialization-lib-nodejs';

export interface AdaVerifierConfig {
  privkey: string;
  ckbAddress: string;
  ckbPubkeyHash: string;
  adaPubkeyHash: string;
  adaSigningKey: string;
}

export function genRandomVerifierConfig(): AdaVerifierConfig {
  const recoveryPhrase = Seed.generateRecoveryPhrase();
  const rootKey = utils.mnemonicToRootKey(recoveryPhrase);
  // TODO: use the same root key
  const privkey = genRandomHex(64);
  const signingKey = utils.deriveSigningKey(rootKey, 0, 0);
  return {
    privkey,
    ckbAddress: privateKeyToCkbAddress(privkey),
    ckbPubkeyHash: privateKeyToCkbPubkeyHash(privkey),
    adaPubkeyHash: utils.privateKeyToAdaPubkeyHash(signingKey),
    adaSigningKey: Buffer.from(signingKey.to_raw_key().as_bytes()).toString('hex'),
  };
}
export interface DeployDevResult {
  ckbDeps: CkbDeps;
  ownerConfig: OwnerCellConfig;
  multisigConfig: {
    threshold: number;
    verifiers: AdaVerifierConfig[];
  };
  ckbStartHeight: number;
  ckbPrivateKey: string;
}

export async function deployDev(
  CKB_RPC_URL: string,
  CKB_INDEXER_URL: string,
  MULTISIG_NUMBER: number,
  MULTISIG_THRESHOLD: number,
  ckbPrivateKey: string,
  env: 'LINA' | 'AGGRON4' | 'DEV' = 'DEV',
  cachePath?: string,
  ckbDeps?: CkbDeps,
): Promise<DeployDevResult> {
  if (cachePath && fs.existsSync(cachePath)) {
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  }
  initLumosConfig(env);
  const verifierConfigs = lodash.range(MULTISIG_NUMBER).map((_i) => genRandomVerifierConfig());
  logger.debug('verifierConfigs', verifierConfigs);
  const ckbDeployGenerator = new CkbDeployManager(CKB_RPC_URL, CKB_INDEXER_URL);
  if (!ckbDeps) {
    // deploy ckb contracts
    let sudtDep;
    let PATH_BRIDGE_LOCKSCRIPT;
    let PATH_RECIPIENT_TYPESCRIPT;
    if (env === 'DEV') {
      PATH_RECIPIENT_TYPESCRIPT = pathFromProjectRoot('/ckb-contracts/build/release-devnet/recipient-typescript');
      PATH_BRIDGE_LOCKSCRIPT = pathFromProjectRoot('/ckb-contracts/build/release-devnet/bridge-lockscript');
      const PATH_SUDT_DEP = pathFromProjectRoot('/offchain-modules/deps/simple_udt');
      const sudtBin = fs.readFileSync(PATH_SUDT_DEP);
      sudtDep = await ckbDeployGenerator.deploySudt(sudtBin, ckbPrivateKey);
    } else if (env === 'AGGRON4') {
      PATH_RECIPIENT_TYPESCRIPT = pathFromProjectRoot('/ckb-contracts/build/release-aggron/recipient-typescript');
      PATH_BRIDGE_LOCKSCRIPT = pathFromProjectRoot('/ckb-contracts/build/release-aggron/bridge-lockscript');
      sudtDep = {
        cellDep: {
          depType: 'code',
          outPoint: {
            txHash: '0xe12877ebd2c3c364dc46c5c992bcfaf4fee33fa13eebdf82c591fc9825aab769',
            index: '0x0',
          },
        },
        script: {
          codeHash: '0xc5e5dcf215925f7ef4dfaf5f4b4f105bc321c02776d6e7d52a1db3fcd9d011a4',
          hashType: 'type',
        },
      };
    } else {
      throw new Error(`wrong env: ${env}`);
    }
    const contractsDeps = await ckbDeployGenerator.deployContracts(
      {
        bridgeLockscript: fs.readFileSync(PATH_BRIDGE_LOCKSCRIPT),
        recipientTypescript: fs.readFileSync(PATH_RECIPIENT_TYPESCRIPT),
      },
      ckbPrivateKey,
    );
    logger.info('deps', { contractsDeps, sudtDep });
    ckbDeps = {
      sudtType: sudtDep,
      ...contractsDeps,
    };
  }
  const multisigItem = {
    R: 0,
    M: MULTISIG_THRESHOLD,
    publicKeyHashes: verifierConfigs.map((vc) => vc.ckbPubkeyHash),
  };
  const ownerConfig: OwnerCellConfig = await ckbDeployGenerator.createOwnerCell(multisigItem, ckbPrivateKey, '0x01');
  logger.info('ownerConfig', ownerConfig);
  // generate_configs
  const multisigConfig = {
    threshold: MULTISIG_THRESHOLD,
    verifiers: verifierConfigs,
  };
  // get start height
  const delta = 1;
  const ckb = new CKB(CKB_RPC_URL);
  const ckbStartHeight = Number(await ckb.rpc.getTipBlockNumber()) - delta;
  logger.debug('start height', { ckbStartHeight });
  const data = {
    ckbDeps,
    ownerConfig,
    multisigConfig,
    ckbStartHeight,
    ckbPrivateKey,
  };
  if (cachePath) {
    writeJsonToFile(data, cachePath);
  }
  return data;
}
