const { ethers } = require('hardhat');
const { expect } = require('chai');
const { keccak256, defaultAbiCoder, toUtf8Bytes } = ethers.utils;

describe('AssetManager', () => {
    const ckbAssetId = keccak256(toUtf8Bytes('CKB'));
    const sudtAssetId = keccak256(toUtf8Bytes('example sudt'));
    let assetManager;
    let ckb, sudt;
    let deployer, user1, user2;

    before(async () => {
        [deployer, user1, user2] = await ethers.getSigners();
        // create ckb mirror token
        const NervosMirrorToken = await ethers.getContractFactory('NervosMirrorToken');
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
    })

    it('Nervos to Ethereum cross chain with single signature admin', async () => {
        // mint
        const mintRecords = [
            {
                assetId: ckbAssetId,
                to: user1.address,
                amount: 100000000,
                lockId: '0x0000000000000000000000000000000000000000000000000000000000000001',
            },
            {
                assetId: sudtAssetId,
                to: user2.address,
                amount: ethers.utils.parseUnits('1', 18),
                lockId: '0x0000000000000000000000000000000000000000000000000000000000000002',
            }
        ]
        // console.log({mintRecords})
        const mintTx = await assetManager.mint(mintRecords)
        const mintReceipt = await mintTx.wait()
        // console.log({ mintTx, mintReceipt })
        const mintEvents = mintReceipt.events.filter(e => e.event === 'Mint').map(e => e.args)
        // console.log(mintEvents)
        expect(mintEvents).to.have.lengthOf(2)
        expect(mintEvents[0].assetId).to.equal(ckbAssetId)
        expect(mintEvents[0].to).to.equal(user1.address)
        expect(mintEvents[0].amount).to.equal(100000000)
        expect(mintEvents[0].lockId).to.equal('0x0000000000000000000000000000000000000000000000000000000000000001')
        expect(mintEvents[1].assetId).to.equal(sudtAssetId)
        expect(mintEvents[1].to).to.equal(user2.address)
        expect(mintEvents[1].amount).to.equal(ethers.utils.parseUnits('1', 18))
        expect(mintEvents[1].lockId).to.equal('0x0000000000000000000000000000000000000000000000000000000000000002')

        // check balance
        expect(await ckb.balanceOf(user1.address)).to.equal(100000000);
        expect(await sudt.balanceOf(user2.address)).to.equal(ethers.utils.parseUnits('1', 18));

        // burn
        const burnTx1 = await assetManager.connect(user1).burn(ckb.address, 100000000)
        const burnReceipt1 = await burnTx1.wait()
        const burnEvents1 = burnReceipt1.events.filter(e => e.event === 'Burn').map(e => e.args)
        // console.log({ burnEvents1 })
        expect(burnEvents1).to.have.lengthOf(1)
        expect(burnEvents1[0].assetId).to.equal(ckbAssetId)
        expect(burnEvents1[0].from).to.equal(user1.address)
        expect(burnEvents1[0].amount).to.equal(100000000)
        expect(burnEvents1[0].token).to.equal(ckb.address)
    })
})