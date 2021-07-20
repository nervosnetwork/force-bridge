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
}

export async function deployDev(
  ETH_RPC_URL: string,
  CKB_RPC_URL: string,
  CKB_INDEXER_URL: string,
  MULTISIG_NUMBER: number,
  MULTISIG_THRESHOLD: number,
  ETH_PRIVATE_KEY: string,
  CKB_PRIVATE_KEY: string,
  cachePath?: string,
): Promise<DeployDevResult> {
  if (cachePath && fs.existsSync(cachePath)) {
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  }
  initLumosConfig();
  const verifierConfigs = lodash.range(MULTISIG_NUMBER).map((_i) => genRandomVerifierConfig());
  logger.debug('verifierConfigs', verifierConfigs);
  const ethMultiSignAddresses = verifierConfigs.map((vc) => vc.ethAddress);
  // deploy eth contract
  const bridgeEthAddress = await deployEthContract(
    ETH_RPC_URL,
    ETH_PRIVATE_KEY,
    ethMultiSignAddresses,
    MULTISIG_THRESHOLD,
  );
  logger.info(`bridge address: ${bridgeEthAddress}`);
  // deploy ckb contracts
  const PATH_SUDT_DEP = pathFromProjectRoot('/offchain-modules/deps/simple_udt');
  const PATH_RECIPIENT_TYPESCRIPT = pathFromProjectRoot('/ckb-contracts/build/release/recipient-typescript');
  const PATH_BRIDGE_LOCKSCRIPT = pathFromProjectRoot('/ckb-contracts/build/release/bridge-lockscript');
  const ckbDeployGenerator = new CkbDeployManager(CKB_RPC_URL, CKB_INDEXER_URL);
  const contractsDeps = await ckbDeployGenerator.deployContracts(
    {
      bridgeLockscript: fs.readFileSync(PATH_BRIDGE_LOCKSCRIPT),
      recipientTypescript: fs.readFileSync(PATH_RECIPIENT_TYPESCRIPT),
    },
    CKB_PRIVATE_KEY,
  );
  const sudtBin = fs.readFileSync(PATH_SUDT_DEP);
  const sudtDep = await ckbDeployGenerator.deploySudt(sudtBin, CKB_PRIVATE_KEY);
  logger.info('deps', { contractsDeps, sudtDep });
  const multisigItem = {
    R: 0,
    M: MULTISIG_THRESHOLD,
    publicKeyHashes: verifierConfigs.map((vc) => vc.ckbPubkeyHash),
  };
  const ownerConfig: OwnerCellConfig = await ckbDeployGenerator.createOwnerCell(multisigItem, CKB_PRIVATE_KEY);
  logger.info('ownerConfig', ownerConfig);
  // generate_configs
  const assetWhiteList: WhiteListEthAsset[] = JSON.parse(
    fs.readFileSync(pathFromProjectRoot('/configs/testnet-asset-white-list.json'), 'utf8'),
  );
  const ckbDeps = {
    sudtType: sudtDep,
    ...contractsDeps,
  };
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
  };
  if (cachePath) {
    writeJsonToFile(data, cachePath);
  }
  return data;
}
