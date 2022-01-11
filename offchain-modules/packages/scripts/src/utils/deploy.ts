import fs from 'fs';
import { CkbDeployManager, OwnerCellConfig, OmniLockCellConfig } from '@force-bridge/x/dist/ckb/tx-helper/deploy';
import { initLumosConfig } from '@force-bridge/x/dist/ckb/tx-helper/init_lumos_config';
import { CkbDeps, WhiteListEthAsset, WhiteListNervosAsset } from '@force-bridge/x/dist/config';
import { writeJsonToFile } from '@force-bridge/x/dist/utils';
import { logger } from '@force-bridge/x/dist/utils/logger';
import { deployEthContract, deployAssetManager, deploySafe, deployEthMirror } from '@force-bridge/x/dist/xchain/eth';
import CKB from '@nervosnetwork/ckb-sdk-core';
import { ethers } from 'ethers';
import * as lodash from 'lodash';
import { genRandomVerifierConfig, VerifierConfig } from './generate';
import { pathFromProjectRoot } from './index';

export interface DeployDevResult {
  assetWhiteList: WhiteListEthAsset[];
  nervosAssetWhiteList: WhiteListNervosAsset[];
  ckbDeps: CkbDeps;
  ownerConfig: OwnerCellConfig;
  omniLockConfig: OmniLockCellConfig;
  bridgeEthAddress: string;
  multisigConfig: {
    threshold: number;
    verifiers: VerifierConfig[];
  };
  ckbStartHeight: number;
  ethStartHeight: number;
  ckbPrivateKey: string;
  ethPrivateKey: string;
  assetManagerContractAddress: string;
  safeAddress: string;
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

  const safeAddress = await deploySafe(ETH_RPC_URL, ethPrivateKey, MULTISIG_THRESHOLD, ethMultiSignAddresses);
  logger.info(`safe address: ${safeAddress}`);

  const assetManagerContract = await deployAssetManager(ETH_RPC_URL, ethPrivateKey, safeAddress);
  logger.info(`asset manager address: ${assetManagerContract.address}`);

  const ckbDeployGenerator = new CkbDeployManager(CKB_RPC_URL, CKB_INDEXER_URL);
  if (!ckbDeps) {
    // deploy ckb contracts
    let sudtDep;
    let pwLockDep;
    let omniLockDep;
    let PATH_BRIDGE_LOCKSCRIPT;
    let PATH_RECIPIENT_TYPESCRIPT;
    if (env === 'DEV') {
      PATH_RECIPIENT_TYPESCRIPT = pathFromProjectRoot('/ckb-contracts/build/release-devnet/recipient-typescript');
      PATH_BRIDGE_LOCKSCRIPT = pathFromProjectRoot('/ckb-contracts/build/release-devnet/bridge-lockscript');
      const PATH_SUDT_DEP = pathFromProjectRoot('/offchain-modules/deps/simple_udt');
      const PATH_PW_LOCK_DEP = pathFromProjectRoot('/offchain-modules/deps/pw_lock');
      const PATH_OMNI_LOCK_DEP = pathFromProjectRoot('/offchain-modules/deps/omni_lock');
      const sudtBin = fs.readFileSync(PATH_SUDT_DEP);
      const pwLockBin = fs.readFileSync(PATH_PW_LOCK_DEP);
      const omniLockBin = fs.readFileSync(PATH_OMNI_LOCK_DEP);
      [sudtDep, pwLockDep, omniLockDep] = await ckbDeployGenerator.deployScripts(
        [sudtBin, pwLockBin, omniLockBin],
        ckbPrivateKey,
      );
      logger.info('deployed pwLockDep', JSON.stringify(pwLockDep, null, 2));
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
      pwLockDep = {
        cellDep: {
          depType: 'code',
          outPoint: {
            txHash: '0x57a62003daeab9d54aa29b944fc3b451213a5ebdf2e232216a3cfed0dde61b38',
            index: '0x0',
          },
        },
        script: {
          codeHash: '0x58c5f491aba6d61678b7cf7edf4910b1f5e00ec0cde2f42e0abb4fd9aff25a63',
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
      pwLock: pwLockDep,
      omniLock: omniLockDep,
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
  const omniLockConfig: OmniLockCellConfig = await ckbDeployGenerator.createOmniLockAdminCell(
    multisigItem,
    ckbPrivateKey,
    ckbDeps.omniLock!.script,
  );
  logger.info('omniLockConfig', omniLockConfig);

  const ckbToEthMirror = new Map<string, { name: string; symbol: string; decimals: number }>();

  ckbToEthMirror.forEach(async (v, k) => {
    const ckbEthMirror = await deployEthMirror(ETH_RPC_URL, ethPrivateKey, v.name, v.symbol, v.decimals);
    logger.info(`ckb mirror address: ${ckbEthMirror.address} asset id:${k}`);

    await ckbEthMirror.transferOwnership(assetManagerContract.address);
    await assetManagerContract.addAsset(ckbEthMirror.address, k);
  });

  // generate_configs
  let assetWhiteListPath: string;
  let nervosAssetWhiteListPath: string;
  if (env === 'DEV') {
    assetWhiteListPath = pathFromProjectRoot('/configs/devnet-asset-white-list.json');
    nervosAssetWhiteListPath = pathFromProjectRoot('/configs/devnet-nervos-asset-white-list.json');
  } else if (env === 'AGGRON4') {
    assetWhiteListPath = pathFromProjectRoot('/configs/testnet-asset-white-list.json');
    nervosAssetWhiteListPath = pathFromProjectRoot('/configs/testnet-nervos-asset-white-list.json');
  } else {
    throw new Error(`wrong env: ${env}`);
  }
  const assetWhiteList: WhiteListEthAsset[] = JSON.parse(fs.readFileSync(assetWhiteListPath, 'utf8'));
  const nervosAssetWhiteList: WhiteListNervosAsset[] = JSON.parse(fs.readFileSync(nervosAssetWhiteListPath, 'utf8'));
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
    nervosAssetWhiteList,
    ckbDeps,
    ownerConfig,
    omniLockConfig,
    bridgeEthAddress,
    multisigConfig,
    ckbStartHeight,
    ethStartHeight,
    ethPrivateKey,
    ckbPrivateKey,
    assetManagerContractAddress: assetManagerContract.address,
    safeAddress,
  };
  if (cachePath) {
    writeJsonToFile(data, cachePath);
  }
  return data;
}
