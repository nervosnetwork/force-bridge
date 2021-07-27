import fs from 'fs';
import { CkbDeployManager, OwnerCellConfig } from '@force-bridge/x/dist/ckb/tx-helper/deploy';
import { initLumosConfig } from '@force-bridge/x/dist/ckb/tx-helper/init_lumos_config';
import { CkbDeps, WhiteListEthAsset } from '@force-bridge/x/dist/config';
import { writeJsonToFile } from '@force-bridge/x/dist/utils';
import { logger } from '@force-bridge/x/dist/utils/logger';
import { deployEthContract } from '@force-bridge/x/dist/xchain/eth';
import CKB from '@nervosnetwork/ckb-sdk-core';
import { ethers } from 'ethers';
import * as lodash from 'lodash';
import { genRandomVerifierConfig, VerifierConfig } from './generate';
import { pathFromProjectRoot } from './index';

export interface DeployDevResult {
  assetWhiteList: WhiteListEthAsset[];
  ckbDeps: CkbDeps;
  ownerConfig: OwnerCellConfig;
  bridgeEthAddress: string;
  multisigConfig: {
    threshold: number;
    verifiers: VerifierConfig[];
  };
  ckbStartHeight: number;
  ethStartHeight: number;
  ckbPrivateKey: string;
  ethPrivateKey: string;
}

export async function deployDev(
  ETH_RPC_URL: string,
  CKB_RPC_URL: string,
  CKB_INDEXER_URL: string,
  MULTISIG_NUMBER: number,
  MULTISIG_THRESHOLD: number,
  ethPrivateKey: string,
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
  const ethMultiSignAddresses = verifierConfigs.map((vc) => vc.ethAddress);
  // deploy eth contract
  const bridgeEthAddress = await deployEthContract(
    ETH_RPC_URL,
    ethPrivateKey,
    ethMultiSignAddresses,
    MULTISIG_THRESHOLD,
  );
  logger.info(`bridge address: ${bridgeEthAddress}`);
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
  const ownerConfig: OwnerCellConfig = await ckbDeployGenerator.createOwnerCell(multisigItem, ckbPrivateKey);
  logger.info('ownerConfig', ownerConfig);
  // generate_configs
  const assetWhiteList: WhiteListEthAsset[] = JSON.parse(
    fs.readFileSync(pathFromProjectRoot('/configs/testnet-asset-white-list.json'), 'utf8'),
  );
  const multisigConfig = {
    threshold: MULTISIG_THRESHOLD,
    verifiers: verifierConfigs,
  };
  // get start height
  const provider = new ethers.providers.JsonRpcProvider(ETH_RPC_URL);
  const delta = 1;
  const ethStartHeight = (await provider.getBlockNumber()) - delta;
  const ckb = new CKB(CKB_RPC_URL);
  const ckbStartHeight = Number(await ckb.rpc.getTipBlockNumber()) - delta;
  logger.debug('start height', { ethStartHeight, ckbStartHeight });
  const data = {
    assetWhiteList,
    ckbDeps,
    ownerConfig,
    bridgeEthAddress,
    multisigConfig,
    ckbStartHeight,
    ethStartHeight,
    ethPrivateKey,
    ckbPrivateKey,
  };
  if (cachePath) {
    writeJsonToFile(data, cachePath);
  }
  return data;
}
