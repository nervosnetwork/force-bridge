import fs from 'fs';
import { CkbDeployManager, OmniLockCellConfig, OwnerCellConfig } from '@force-bridge/x/dist/ckb/tx-helper/deploy';
import { initLumosConfig, LumosConfigType } from '@force-bridge/x/dist/ckb/tx-helper/init_lumos_config';
import { MultisigItem } from '@force-bridge/x/dist/config';
import { initLog, logger } from '@force-bridge/x/dist/utils/logger';
import commander from 'commander';

async function deployOwnerCell(opts: Record<string, string>): Promise<void> {
  const { ckbRpcUrl, ckbIndexerUrl, env, ckbPrivateKey, R, M, publicKeyHashes, multiCellXchainType } = opts;
  if (parseInt(R).toString() === 'NaN') throw new Error('R is NaN');
  if (parseInt(M).toString() === 'NaN') throw new Error('M is NaN');
  initLumosConfig(env as LumosConfigType);
  const ckbDeployGenerator = new CkbDeployManager(ckbRpcUrl, ckbIndexerUrl);
  const multisigItem: MultisigItem = {
    R: parseInt(R),
    M: parseInt(M),
    publicKeyHashes: publicKeyHashes.split(','),
  };
  const ownerConfig: OwnerCellConfig = await ckbDeployGenerator.createOwnerCell(
    multisigItem,
    ckbPrivateKey,
    multiCellXchainType,
  );
  logger.info(`ownerConfig: ${JSON.stringify(ownerConfig)}`);
  fs.writeFileSync('owner-cell-result.json', JSON.stringify(ownerConfig, null, 2));
}

async function deployAdminCell(opts: Record<string, string>): Promise<void> {
  const {
    ckbRpcUrl,
    ckbIndexerUrl,
    env,
    ckbPrivateKey,
    R,
    M,
    publicKeyHashes,
    omniLockScriptCodeHash,
    omniLockScriptHashType,
  } = opts;
  if (parseInt(R).toString() === 'NaN') throw new Error('R is NaN');
  if (parseInt(M).toString() === 'NaN') throw new Error('M is NaN');
  initLumosConfig(env as LumosConfigType);
  const ckbDeployGenerator = new CkbDeployManager(ckbRpcUrl, ckbIndexerUrl);
  const multisigItem: MultisigItem = {
    R: parseInt(R),
    M: parseInt(M),
    publicKeyHashes: publicKeyHashes.split(','),
  };

  const omniLockConfig: OmniLockCellConfig = await ckbDeployGenerator.createOmniLockAdminCell(
    multisigItem,
    ckbPrivateKey,
    {
      codeHash: omniLockScriptCodeHash,
      hashType: omniLockScriptHashType as 'type' | 'data' | 'data1',
    },
  );

  logger.info(`omniLockConfig: ${JSON.stringify(omniLockConfig)}`);
  fs.writeFileSync('admin-cell-result.json', JSON.stringify(omniLockConfig, null, 2));
}

const CkbNodeRpc = 'https://mainnet.ckb.dev/rpc';
const CkbIndexerRpc = 'https://mainnet.ckb.dev/indexer';
const program = commander.program;

async function main() {
  initLog({ level: 'debug', identity: 'ckb-upgrade-deploy' });
  const ownerCellCommand = new commander.Command('owner-cell');
  ownerCellCommand
    .option('--ckbRpcUrl <ckbRpcUrl>', 'Url of ckb rpc', CkbNodeRpc)
    .option('--ckbIndexerUrl <ckbIndexerRpcUrl>', 'Url of ckb indexer url', CkbIndexerRpc)
    .option('--env <env>', 'env: DEV | AGGRON4 | LINA', 'LINA')
    .requiredOption('-p, --ckbPrivateKey <ckbPrivateKey>', 'ckb private key ')
    .requiredOption('-R <R>', 'R')
    .requiredOption('-M <M>', 'M')
    .requiredOption('--publicKeyHashes <publicKeyHashes>', 'publicKeyHashes')
    .requiredOption(
      '-x, --multiCellXchainType <multiCellXchainType>',
      'insulate multi cell when generate mint tx, Ethereum=0x01, Bsc=0x02',
    )
    .action(deployOwnerCell);
  const adminCellCommand = new commander.Command('admin-cell');
  adminCellCommand
    .option('--ckbRpcUrl <ckbRpcUrl>', 'Url of ckb rpc', CkbNodeRpc)
    .option('--ckbIndexerUrl <ckbIndexerRpcUrl>', 'Url of ckb indexer url', CkbIndexerRpc)
    .option('--env <env>', 'env: DEV | AGGRON4 | LINA', 'LINA')
    .requiredOption('-p, --ckbPrivateKey <ckbPrivateKey>', 'ckb private key ')
    .requiredOption('-R <R>', 'R')
    .requiredOption('-M <M>', 'M')
    .requiredOption('--publicKeyHashes <publicKeyHashes>', 'publicKeyHashes')
    .requiredOption('--omniLockScriptCodeHash <omniLockScriptCodeHash>', 'omniLockScriptCodeHash')
    .requiredOption('--omniLockScriptHashType <omniLockScriptHashType>', 'omniLockScriptHashType: type | data | data1')
    .action(deployAdminCell);
  program
    .description('ckb upgrade deploy is command line tool to deploy ckb cells when upgrade force bridge ckb2eth')
    .addCommand(ownerCellCommand)
    .addCommand(adminCellCommand);
  await program.parseAsync(process.argv);
}

void main();
