import {
  deployAssetManager,
  deploySafe,
  deployEthMirror,
  unsignedAddEthMirrorTxToFile,
  signAddEthMirrorTxToFile,
  sendEthMirrorTxFromFiles,
} from '@force-bridge/x/dist/xchain/eth';
import commander from 'commander';

export const deploy = new commander.Command('deploy');
deploy
  .command('gnosis-safe')
  .requiredOption('-u --ethRpcUrl <ethRpcUrl>', 'Url of eth rpc')
  .requiredOption('-p --privateKey <privateKey>', 'eth private key')
  .requiredOption('-t --threshold <threshold>', 'threshold of multisignature', parseInt)
  .requiredOption('-v --verifiers <verifiers...>', 'verifiers of multisignature')
  .action(doDeploySafe)
  .description('deploy a gnosis safe contract');

deploy
  .command('asset-manager')
  .requiredOption('-u --ethRpcUrl <ethRpcUrl>', 'Url of eth rpc')
  .requiredOption('-p --privateKey <privateKey>', 'eth private key')
  .requiredOption('-s --safeAddress <safeAddress>', 'gnosis safe contract address')
  .action(doDeployAssetManager)
  .description('deploy a asset manager contract');

deploy
  .command('mirror-token')
  .requiredOption('-u --ethRpcUrl <ethRpcUrl>', 'Url of eth rpc')
  .requiredOption('-p --privateKey <privateKey>', 'eth private key')
  .requiredOption('-n --name <name>', 'name of token')
  .requiredOption('-s --symbol <symbol>', 'symbol of token')
  .requiredOption('-a --assetManagerAddress <assetManagerAddress>', 'asset manager contract address')
  .option('-d decimal <decimal>', 'decimal of token', parseInt)
  .action(doDeployEthMirror)
  .description('deploy a mirror token.');

deploy
  .command('generate-add-eth-mirror-tx')
  .requiredOption('-u --url <ethRpcUrl>', 'Url of eth rpc')
  .requiredOption('-s --safeAddress <safeAddress>', 'gnosis safe contract address')
  .requiredOption('-a --assetManagerAddress <assetManagerAddress>', 'asset manager contract address')
  .requiredOption('-m --mirrorTokenAddress <mirrorTokenAddress>', 'ckb mirror token address')
  .requiredOption('-p --privateKey <privateKey>', 'eth private key')
  .requiredOption('-t --typescriptHash <typescriptHash>', 'sudt/ckb typescriptHash')
  .requiredOption('-f --file <filePath>', 'file to write tx to.')
  .action(doUnsignedAddEthMirror)
  .description('generate unsigned add eth mirror token tx.');

deploy
  .command('sign-add-eth-mirror-tx')
  .requiredOption('-f --file <filePath>', 'the file which the tx stored in.')
  .requiredOption('-p --privateKey <privateKey>', 'eth private key')
  .action(doSignAddEthMirrorTx)
  .description('sign the add eth mirror token tx.');

deploy
  .command('send-add-eth-mirror-tx')
  .requiredOption('-d --dir <basePath>', 'the dir which the files stored in')
  .requiredOption('-p --privateKey <privateKey>', 'eth private key')
  .action(doSendAddEthMirrorTokenTx)
  .description('send the add eth mirror token tx');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function doDeploySafe(opts: Record<string, any>): Promise<void> {
  try {
    const { safeAddress } = await deploySafe(opts.ethRpcUrl, opts.privateKey, opts.threshold, opts.owners);
    console.log(`safe contract deployed. address: ${safeAddress}`);
  } catch (e) {
    console.error(`failed to deploy gnosis safe contract. ${e}`);
  }
}

async function doDeployAssetManager(opts: Record<string, string>): Promise<void> {
  try {
    const assetManagerContract = await deployAssetManager(opts.ethRpcUrl, opts.privateKey, opts.safeAddress);
    console.log(`asset manager contract deployed. address: ${assetManagerContract.address}`);
  } catch (e) {
    console.error(`failed to deploy asset manager contract. ${e}`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function doDeployEthMirror(opts: Record<string, any>): Promise<void> {
  try {
    const mirrorToken = await deployEthMirror(
      opts.ethRpcUrl,
      opts.privateKey,
      opts.name,
      opts.symbol,
      opts.decimal,
      opts.assetManagerAddress,
    );

    console.log(`mirror token deployed. address: ${mirrorToken.address}`);
  } catch (e) {
    console.error(`failed to deploy mirror token. ${e}`);
  }
}

async function doUnsignedAddEthMirror(opts: Record<string, string>): Promise<void> {
  try {
    await unsignedAddEthMirrorTxToFile(
      opts.ethRpcUrl,
      opts.safeAddress,
      opts.assetManagerAddress,
      opts.mirrorTokenAddress,
      opts.typescriptHash,
      opts.privateKey,
      opts.filePath,
    );

    console.log('unsigned add eth mirror token tx generated successfully.');
  } catch (e) {
    console.error(`failed to generate unsigned add mirror token tx. ${e}`);
  }
}

async function doSignAddEthMirrorTx(opts: Record<string, string>): Promise<void> {
  try {
    await signAddEthMirrorTxToFile(opts.filePath, opts.privateKey);
    console.log('sign add eth mirror token tx successfully.');
  } catch (e) {
    console.error(`failed to sign add mirror token tx. ${e}`);
  }
}

async function doSendAddEthMirrorTokenTx(opts: Record<string, string>): Promise<void> {
  try {
    await sendEthMirrorTxFromFiles(opts.basePath, opts.privateKey);
    console.log('send add eth mirror token tx successfully.');
  } catch (e) {
    console.error(`failed to send add mirror token tx. ${e}`);
  }
}
