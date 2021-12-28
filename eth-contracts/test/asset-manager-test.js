const { ethers } = require('hardhat');
const { expect } = require('chai');
const { keccak256, defaultAbiCoder, toUtf8Bytes } = ethers.utils;
const {
  EthersAdapter,
  SafeFactory,
  SafeAccountConfig
} = require('@gnosis.pm/safe-core-sdk');
const EthSafeTransaction = require('@gnosis.pm/safe-core-sdk/dist/src/utils/transactions/SafeTransaction')
  .default;
const Safe = require('@gnosis.pm/safe-core-sdk').default;

async function setupGnosis() {
  const { chainId } = await ethers.provider.getNetwork();
  const MultiSend = await ethers.getContractFactory('MultiSend_SV1_3_0');
  const multiSend = await MultiSend.deploy();
  const GnosisSafe = await ethers.getContractFactory('GnosisSafe_SV1_3_0');
  const gnosisSafe = await GnosisSafe.deploy();
  const Proxyfactory = await ethers.getContractFactory('ProxyFactory_SV1_3_0');
  const proxyFactory = await Proxyfactory.deploy();
  const contractNetworks = {
    [chainId]: {
      multiSendAddress: multiSend.address,
      safeMasterCopyAddress: gnosisSafe.address,
      safeProxyFactoryAddress: proxyFactory.address
    }
  };
  return contractNetworks;
}

async function getSignature(signer, safeAddress, contractNetworks, partialTx) {
  const ethAdapter = new EthersAdapter({
    ethers,
    signer
  });
  const safeSdk = await Safe.create({
    ethAdapter,
    safeAddress,
    contractNetworks
  });
  const tx = await safeSdk.createTransaction(partialTx);
  const txHash = await safeSdk.getTransactionHash(tx);
  const signature = await safeSdk.signTransactionHash(txHash);
  return signature;
}

describe('AssetManager', () => {
  const ckbAssetId = keccak256(toUtf8Bytes('CKB'));
  const sudtAssetId = keccak256(toUtf8Bytes('example sudt'));
  let assetManager;
  let ckb, sudt;
  let deployer, user1, user2;
  let multisig1, multisig2, multisig3, multisig4, multisig5, collector;
  let contractNetworks;

  before(async () => {
    [
      deployer,
      user1,
      user2,
      multisig1,
      multisig2,
      multisig3,
      multisig4,
      multisig5,
      collector
    ] = await ethers.getSigners();
    // create ckb mirror token
    const NervosMirrorToken = await ethers.getContractFactory(
      'NervosMirrorToken'
    );
    ckb = await NervosMirrorToken.deploy('Nervos CKB', 'CKB', 8);
    sudt = await NervosMirrorToken.deploy('Nervos SUDT Michi Token', 'MT', 18);

    // create sudt mirror token
    const AssetManager = await ethers.getContractFactory('AssetManager');
    assetManager = await AssetManager.deploy();
    // addAsset pair and transfer mirror token to asset manager, make it mintable
    await assetManager.addAsset(ckb.address, ckbAssetId);
    await ckb.transferOwnership(assetManager.address);
    await assetManager.addAsset(sudt.address, sudtAssetId);
    await sudt.transferOwnership(assetManager.address);

    contractNetworks = await setupGnosis();
  });

  it('Nervos to Ethereum cross chain with single signature admin', async () => {
    // mint
    const mintRecords = [
      {
        assetId: ckbAssetId,
        to: user1.address,
        amount: 100000000,
        lockId:
          '0x0000000000000000000000000000000000000000000000000000000000000001'
      },
      {
        assetId: sudtAssetId,
        to: user2.address,
        amount: ethers.utils.parseUnits('1', 18),
        lockId:
          '0x0000000000000000000000000000000000000000000000000000000000000002'
      }
    ];
    // console.log({mintRecords})
    const mintTx = await assetManager.mint(mintRecords);
    const mintReceipt = await mintTx.wait();
    // console.log({ mintTx, mintReceipt })
    const mintEvents = mintReceipt.events
      .filter(e => e.event === 'Mint')
      .map(e => e.args);
    // console.log(mintEvents)
    expect(mintEvents).to.have.lengthOf(2);
    expect(mintEvents[0].assetId).to.equal(ckbAssetId);
    expect(mintEvents[0].to).to.equal(user1.address);
    expect(mintEvents[0].amount).to.equal(100000000);
    expect(mintEvents[0].lockId).to.equal(
      '0x0000000000000000000000000000000000000000000000000000000000000001'
    );
    expect(mintEvents[1].assetId).to.equal(sudtAssetId);
    expect(mintEvents[1].to).to.equal(user2.address);
    expect(mintEvents[1].amount).to.equal(ethers.utils.parseUnits('1', 18));
    expect(mintEvents[1].lockId).to.equal(
      '0x0000000000000000000000000000000000000000000000000000000000000002'
    );

    // check balance
    expect(await ckb.balanceOf(user1.address)).to.equal(100000000);
    expect(await sudt.balanceOf(user2.address)).to.equal(
      ethers.utils.parseUnits('1', 18)
    );

    // burn
    const fee = ethers.utils.parseUnits('0.001', 18);
    const burnTx1 = await assetManager
      .connect(user1)
      .burn(ckb.address, 100000000, '0x', '0x', { value: fee });
    const burnReceipt1 = await burnTx1.wait();
    const burnEvents1 = burnReceipt1.events
      .filter(e => e.event === 'Burn')
      .map(e => e.args);
    // console.log({ burnEvents1 })
    expect(burnEvents1).to.have.lengthOf(1);
    expect(burnEvents1[0].assetId).to.equal(ckbAssetId);
    expect(burnEvents1[0].from).to.equal(user1.address);
    expect(burnEvents1[0].amount).to.equal(100000000);
    expect(burnEvents1[0].token).to.equal(ckb.address);
    expect(burnEvents1[0].fee).to.equal(fee);
  });

  it('Nervos to Ethereum cross chain with multi signature admin', async () => {
    // create gnosis multisig contract
    const ethAdapter = new EthersAdapter({
      ethers,
      signer: collector
    });
    const owners = [
      multisig1.address,
      multisig2.address,
      multisig3.address,
      multisig4.address,
      multisig5.address
    ];
    const threshold = 3;
    const safeAccountConfig = {
      owners,
      threshold
    };
    const safeFactory = await SafeFactory.create({
      ethAdapter,
      contractNetworks
    });
    const safeSdk = await safeFactory.deploySafe(safeAccountConfig);
    const safeAddress = safeSdk.getAddress();
    console.log({ safeAddress });

    // transfer ownership to multisig
    await assetManager.transferOwnership(safeAddress);

    // should fail to mint with original owner
    const mintRecords = [
      {
        assetId: ckbAssetId,
        to: user1.address,
        amount: 100000000,
        lockId:
          '0x0000000000000000000000000000000000000000000000000000000000000001'
      },
      {
        assetId: sudtAssetId,
        to: user2.address,
        amount: ethers.utils.parseUnits('1', 18),
        lockId:
          '0x0000000000000000000000000000000000000000000000000000000000000002'
      }
    ];
    await expect(assetManager.mint(mintRecords)).to.be.revertedWith(
      'Ownable: caller is not the owner'
    );

    // should success with gnosis multisig
    const partialTx = {
      to: assetManager.address,
      value: 0,
      data: assetManager.interface.encodeFunctionData('mint', [mintRecords])
    };
    // collect signatures
    const sig1 = await getSignature(
      multisig1,
      safeAddress,
      contractNetworks,
      partialTx
    );
    const sig2 = await getSignature(
      multisig2,
      safeAddress,
      contractNetworks,
      partialTx
    );
    const sig3 = await getSignature(
      multisig3,
      safeAddress,
      contractNetworks,
      partialTx
    );
    // execute tx
    const tx = await safeSdk.createTransaction(partialTx);
    tx.addSignature(sig1);
    tx.addSignature(sig2);
    tx.addSignature(sig3);
    const mintTx = await safeSdk.executeTransaction(tx);
    const mintReceipt = await mintTx.transactionResponse.wait();
    // console.log({ mintTx, mintReceipt })
    const mintEvents = mintReceipt.events
      .filter(e => e.address === assetManager.address)
      .map(e => assetManager.interface.parseLog(e).args);
    // console.log(mintEvents)
    expect(mintEvents).to.have.lengthOf(2);
    expect(mintEvents[0].assetId).to.equal(ckbAssetId);
    expect(mintEvents[0].to).to.equal(user1.address);
    expect(mintEvents[0].amount).to.equal(100000000);
    expect(mintEvents[0].lockId).to.equal(
      '0x0000000000000000000000000000000000000000000000000000000000000001'
    );
    expect(mintEvents[1].assetId).to.equal(sudtAssetId);
    expect(mintEvents[1].to).to.equal(user2.address);
    expect(mintEvents[1].amount).to.equal(ethers.utils.parseUnits('1', 18));
    expect(mintEvents[1].lockId).to.equal(
      '0x0000000000000000000000000000000000000000000000000000000000000002'
    );
  });
});
