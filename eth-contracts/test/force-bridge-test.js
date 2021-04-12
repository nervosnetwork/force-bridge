const { ethers } = require('hardhat');
const { expect } = require('chai');
const { keccak256, defaultAbiCoder, toUtf8Bytes } = ethers.utils;
const {
  log,
  waitingForReceipt,
  generateWallets,
  getUnlockMsgHash,
  generateSignatures,
  assertRevert,
  getChangeValidatorsMsgHash
} = require('./utils');

describe('ForceBridge', () => {
  let forceBridge, adminAddress, contractAddress, provider, factory;
  let wallets, validators;
  let multisigThreshold,
    chainId,
    DOMAIN_SEPARATOR,
    unlockTypeHash,
    changeValidatorsTypeHash;
  let abi, iface;
  let erc20Token, tokenAddress;

  before(async function() {
    // disable timeout
    this.timeout(0);

    const [signer] = await ethers.getSigners();
    adminAddress = signer.address;

    // get validators
    wallets = generateWallets(7);
    validators = wallets.map(wallet => wallet.address);
    multisigThreshold = 5;
    chainId = await signer.getChainId();

    // deploy ForceBridge
    factory = await ethers.getContractFactory(
      'contracts/ForceBridge.sol:ForceBridge'
    );

    forceBridge = await factory.deploy(validators, multisigThreshold);
    await forceBridge.deployTransaction.wait(1);

    contractAddress = forceBridge.address;
    provider = forceBridge.provider;

    abi = require('../artifacts/contracts/ForceBridge.sol/ForceBridge.json')
      .abi;
    iface = new ethers.utils.Interface(abi);

    // deploy ERC20 token
    const erc20Factory = await ethers.getContractFactory(
      'contracts/test/ERC20.sol:DAI'
    );

    erc20Token = await erc20Factory.deploy();
    await erc20Token.deployTransaction.wait(1);
    await erc20Token.approve(contractAddress, 100);
    tokenAddress = erc20Token.address;
    console.log('tokenAddress', tokenAddress);
  });

  describe('correct case', async function() {
    // disable timeout
    this.timeout(0);

    it('check SIGNATURE_SIZE, name, AddHistoryTxRootTypeHash, DOMAIN_SEPARATOR', async () => {
      expect(await forceBridge.SIGNATURE_SIZE()).to.eq(65);

      const name = 'Force Bridge';
      expect(await forceBridge.NAME_712()).to.eq(name);

      unlockTypeHash = keccak256(
        toUtf8Bytes('unlock(UnlockRecord[] calldata records)')
      );
      console.log(`unlockTypeHash`, unlockTypeHash);
      expect(await forceBridge.UNLOCK_TYPEHASH()).to.eq(unlockTypeHash);

      changeValidatorsTypeHash = keccak256(
        toUtf8Bytes(
          'changeValidators(address[] validators, uint256 multisigThreshold)'
        )
      );
      console.log(`changeValidatorsTypeHash`, changeValidatorsTypeHash);
      expect(await forceBridge.CHANGE_VALIDATORS_TYPEHASH()).to.eq(
        changeValidatorsTypeHash
      );

      DOMAIN_SEPARATOR = keccak256(
        defaultAbiCoder.encode(
          ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
          [
            keccak256(
              toUtf8Bytes(
                'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'
              )
            ),
            keccak256(toUtf8Bytes(name)),
            keccak256(toUtf8Bytes('1')),
            chainId,
            forceBridge.address
          ]
        )
      );
      expect(await forceBridge.DOMAIN_SEPARATOR()).to.eq(DOMAIN_SEPARATOR);
    });
    it('should work well for lock and unlock ETH', async function() {
      // lock
      const recipientLockscript = '0x00';
      const sudtExtraData = '0x01';
      const amount = ethers.utils.parseEther('0.1');
      const res = await forceBridge.lockETH(
        recipientLockscript,
        sudtExtraData,
        {
          value: amount
        }
      );

      const receipt = await waitingForReceipt(provider, res);
      console.dir(receipt, { depth: null });
      const parsedLog = iface.parseLog(receipt.logs[0]);

      expect(parsedLog.args.token).to.equal(
        '0x0000000000000000000000000000000000000000'
      );
      expect(parsedLog.args.lockedAmount).to.equal(amount);
      expect(parsedLog.args.sudtExtraData).to.equal(sudtExtraData);
      expect(parsedLog.args.recipientLockscript).to.equal(recipientLockscript);

      // unlock
      const records = [
        {
          token: '0x0000000000000000000000000000000000000000',
          recipient: '0x1000000000000000000000000000000000000001',
          amount: ethers.utils.parseEther('0.06'),
          ckbTxHash: '0x1000000000000000000000000000000000000008'
        },
        {
          token: '0x0000000000000000000000000000000000000000',
          recipient: '0x1000000000000000000000000000000000000002',
          amount: ethers.utils.parseEther('0.04'),
          ckbTxHash: '0x1000000000000000000000000000000000000009'
        }
      ];

      const nonce = await forceBridge.latestUnlockNonce_();
      const msgHash = getUnlockMsgHash(
        DOMAIN_SEPARATOR,
        unlockTypeHash,
        records,
        nonce
      );

      console.log('msg hash ', msgHash);
      // 2. generate signatures
      let signatures = generateSignatures(
        msgHash,
        wallets.slice(0, multisigThreshold)
      );

      const resUnlock = await forceBridge.unlock(records, nonce, signatures);

      const receiptUnlock = await waitingForReceipt(provider, resUnlock);
      // console.dir(receiptUnlock, {depth: null});
      const unlockLogs = receiptUnlock.logs.map(l => iface.parseLog(l).args);
      // console.dir(unlockLogs, {depth: null});
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        const res = unlockLogs[i];
        expect(r.recipient).to.equal(res.recipient);
        expect(r.token).to.equal(res.token);
        expect(r.amount).to.equal(res.receivedAmount);
        expect(r.ckbTxHash).to.equal(res.ckbTxHash);
      }
      expect(await forceBridge.latestUnlockNonce_()).to.equal(1);
    });
    it('should work well for lock and unlock ERC20', async function() {
      // lock
      const recipientLockscript = '0x00';
      const sudtExtraData = '0x01';
      const amount = 2;
      const res = await forceBridge.lockToken(
        tokenAddress,
        amount,
        recipientLockscript,
        sudtExtraData
      );

      const receipt = await waitingForReceipt(provider, res);

      console.log(receipt);
      console.dir(receipt, { depth: null });
      const parsedLog = iface.parseLog(receipt.logs[2]);

      expect(parsedLog.args.token).to.equal(tokenAddress);
      expect(parsedLog.args.lockedAmount).to.equal(amount);
      expect(parsedLog.args.sudtExtraData).to.equal(sudtExtraData);
      expect(parsedLog.args.recipientLockscript).to.equal(recipientLockscript);

      // unlock
      const records = [
        {
          token: tokenAddress,
          recipient: '0x1000000000000000000000000000000000000001',
          amount: 1,
          ckbTxHash: '0x1000000000000000000000000000000000000008'
        },
        {
          token: tokenAddress,
          recipient: '0x1000000000000000000000000000000000000002',
          amount: 1,
          ckbTxHash: '0x1000000000000000000000000000000000000009'
        }
      ];

      const nonce = await forceBridge.latestUnlockNonce_();
      const msgHash = getUnlockMsgHash(
        DOMAIN_SEPARATOR,
        unlockTypeHash,
        records,
        nonce
      );

      // 2. generate signatures
      let signatures = generateSignatures(
        msgHash,
        wallets.slice(0, multisigThreshold)
      );

      const resUnlock = await forceBridge.unlock(records, nonce, signatures);

      const receiptUnlock = await waitingForReceipt(provider, resUnlock);
      // console.dir(receiptUnlock, {depth: null});
      for (let i = 1; i < receiptUnlock.logs.length; i += 2) {
        const res = iface.parseLog(receiptUnlock.logs[i]).args;
        const r = records[(i - 1) / 2];
        expect(r.recipient).to.equal(res.recipient);
        expect(r.token).to.equal(res.token);
        expect(r.amount).to.equal(res.receivedAmount);
        expect(r.ckbTxHash).to.equal(res.ckbTxHash);
      }
    });
    it('should change validators', async function() {
      const newWallets = generateWallets(7);
      newValidators = newWallets.map(wallet => wallet.address);
      newMultisigThreshold = 6;

      const nonce = 0;
      const msgHash = getChangeValidatorsMsgHash(
        DOMAIN_SEPARATOR,
        changeValidatorsTypeHash,
        newValidators,
        newMultisigThreshold,
        nonce
      );

      // 2. generate signatures
      let signatures = generateSignatures(msgHash, wallets.slice(0, 7));

      const result = await forceBridge.changeValidators(
        newValidators,
        newMultisigThreshold,
        nonce,
        signatures
      );
      console.log('changeValidators result', result);
      expect(await forceBridge.multisigThreshold_()).to.equal(
        newMultisigThreshold
      );
      expect(await forceBridge.latestChangeValidatorsNonce_()).to.equal(1);
    });
  });

  describe('abnormal case', async function() {
    // disable timeout
    this.timeout(0);

    it('multi sign not reach multiSignThreshold', async () => {
      const msgHash =
        '0x4ba4d5ff07c10a4326368ad11ed2b6d2bcc4915c4de978759f6f7614884c2af4';
      // 2. generate signatures
      let signatures = generateSignatures(
        msgHash,
        wallets.slice(0, multisigThreshold)
      );

      expect(
        await assertRevert(
          forceBridge.validatorsApprove(
            msgHash,
            signatures,
            multisigThreshold + 1
          ),
          'length of signatures must greater than threshold'
        )
      ).to.be.true;
    });
    it('invalid sign', async () => {
      const msgHash =
        '0x4ba4d5ff07c10a4326368ad11ed2b6d2bcc4915c4de978759f6f7614884c2af4';
      // 2. generate signatures
      const newWallets = generateWallets(7);
      let signatures = generateSignatures(
        msgHash,
        newWallets.slice(0, multisigThreshold)
      );

      expect(
        await assertRevert(
          forceBridge.validatorsApprove(msgHash, signatures, multisigThreshold),
          'signatures not verified'
        )
      ).to.be.true;
    });
    it('should not change validators when validators are repeated', async function() {
      const newWallets = generateWallets(7);
      newValidators = newWallets.map(wallet => wallet.address);
      newValidators[6] = newValidators[1];
      newMultisigThreshold = 6;

      const nonce = await forceBridge.latestChangeValidatorsNonce_();
      const msgHash = getChangeValidatorsMsgHash(
        DOMAIN_SEPARATOR,
        changeValidatorsTypeHash,
        newValidators,
        newMultisigThreshold,
        nonce
      );

      // 2. generate signatures
      let signatures = generateSignatures(msgHash, wallets.slice(0, 7));

      expect(
        await assertRevert(
          forceBridge.changeValidators(
            newValidators,
            newMultisigThreshold,
            nonce,
            signatures
          ),
          'repeated validators'
        )
      ).to.be.true;
    });
    it('should not unlock when nonce used', async function() {
      // unlock
      const records = [
        {
          token: '0x0000000000000000000000000000000000000000',
          recipient: '0x1000000000000000000000000000000000000001',
          amount: ethers.utils.parseEther('0.06'),
          ckbTxHash: '0x1000000000000000000000000000000000000008'
        },
        {
          token: '0x0000000000000000000000000000000000000000',
          recipient: '0x1000000000000000000000000000000000000002',
          amount: ethers.utils.parseEther('0.04'),
          ckbTxHash: '0x1000000000000000000000000000000000000009'
        }
      ];

      const nonce = (await forceBridge.latestUnlockNonce_()) - 1;
      const msgHash = getUnlockMsgHash(
        DOMAIN_SEPARATOR,
        unlockTypeHash,
        records,
        nonce
      );

      console.log('msg hash ', msgHash);
      // 2. generate signatures
      let signatures = generateSignatures(
        msgHash,
        wallets.slice(0, multisigThreshold)
      );

      expect(
        await assertRevert(
          forceBridge.unlock(records, nonce, signatures),
          'unlock nonce invalid'
        )
      ).to.be.true;
    });
    it('should not unlock when nonce is not continuous', async function() {
      // unlock
      const records = [
        {
          token: '0x0000000000000000000000000000000000000000',
          recipient: '0x1000000000000000000000000000000000000001',
          amount: ethers.utils.parseEther('0.06'),
          ckbTxHash: '0x1000000000000000000000000000000000000008'
        },
        {
          token: '0x0000000000000000000000000000000000000000',
          recipient: '0x1000000000000000000000000000000000000002',
          amount: ethers.utils.parseEther('0.04'),
          ckbTxHash: '0x1000000000000000000000000000000000000009'
        }
      ];

      const nonce = (await forceBridge.latestUnlockNonce_()) + 1;
      const msgHash = getUnlockMsgHash(
        DOMAIN_SEPARATOR,
        unlockTypeHash,
        records,
        nonce
      );

      console.log('msg hash ', msgHash);
      // 2. generate signatures
      let signatures = generateSignatures(
        msgHash,
        wallets.slice(0, multisigThreshold)
      );

      expect(
        await assertRevert(
          forceBridge.unlock(records, nonce, signatures),
          'unlock nonce invalid'
        )
      ).to.be.true;
    });
    it('should not change validators when nonce used', async function() {
      const newWallets = generateWallets(7);
      newValidators = newWallets.map(wallet => wallet.address);
      newValidators[6] = newValidators[1];
      newMultisigThreshold = 6;

      const nonce = (await forceBridge.latestChangeValidatorsNonce_()) - 1;
      const msgHash = getChangeValidatorsMsgHash(
        DOMAIN_SEPARATOR,
        changeValidatorsTypeHash,
        newValidators,
        newMultisigThreshold,
        nonce
      );

      // 2. generate signatures
      let signatures = generateSignatures(msgHash, wallets.slice(0, 7));

      expect(
        await assertRevert(
          forceBridge.changeValidators(
            newValidators,
            newMultisigThreshold,
            nonce,
            signatures
          ),
          'changeValidators nonce invalid'
        )
      ).to.be.true;
    });
  });
});
