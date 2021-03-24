const { ethers } = require("hardhat");
const { expect } = require("chai");
const { keccak256, defaultAbiCoder, toUtf8Bytes } = ethers.utils;
const {
  log,
  waitingForReceipt,
  generateWallets,
  getUnlockMsgHash,
  generateSignatures,
  getChangeValidatorsMsgHash,
} = require("./utils");

describe("ForceBridge", () => {
  let forceBridge, adminAddress, contractAddress, provider, factory;
  let wallets, validators;
  let multisigThreshold, chainId, DOMAIN_SEPARATOR, unlockTypeHash;
  let initBlockNumber, latestBlockNumber, historyTxRoot, txRootProofDataVec;

  before(async function () {
    // disable timeout
    this.timeout(0);

    const [signer] = await ethers.getSigners();
    adminAddress = signer.address;

    // get validators
    wallets = generateWallets(7);
    validators = wallets.map((wallet) => wallet.address);
    multisigThreshold = 5;
    chainId = await signer.getChainId();

    // deploy ForceBridge
    factory = await ethers.getContractFactory(
      "contracts/ForceBridge.sol:ForceBridge"
    );

    forceBridge = await factory.deploy();
    await forceBridge.deployTransaction.wait(1);
    const res = await forceBridge.initialize(validators, multisigThreshold);
    await res.wait(1);

    contractAddress = forceBridge.address;
    provider = forceBridge.provider;
  });

  describe("correct case", async function () {
    // disable timeout
    this.timeout(0);

    it("check SIGNATURE_SIZE, name, AddHistoryTxRootTypeHash, DOMAIN_SEPARATOR", async () => {
      expect(await forceBridge.SIGNATURE_SIZE()).to.eq(65);

      const name = "Force Bridge";
      expect(await forceBridge.NAME_712()).to.eq(name);

      unlockTypeHash = keccak256(
        toUtf8Bytes("unlock(UnlockRecord[] calldata records)")
      );
      console.log(`unlockTypeHash`, unlockTypeHash);
      expect(await forceBridge.UNLOCK_TYPEHASH()).to.eq(unlockTypeHash);

      DOMAIN_SEPARATOR = keccak256(
        defaultAbiCoder.encode(
          ["bytes32", "bytes32", "bytes32", "uint256", "address"],
          [
            keccak256(
              toUtf8Bytes(
                "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
              )
            ),
            keccak256(toUtf8Bytes(name)),
            keccak256(toUtf8Bytes("1")),
            chainId,
            forceBridge.address,
          ]
        )
      );
      expect(await forceBridge.DOMAIN_SEPARATOR()).to.eq(DOMAIN_SEPARATOR);
    });
    it("should work well for lock and unlock ETH", async function () {
      const abi = require("../artifacts/contracts/ForceBridge.sol/ForceBridge.json")
        .abi;
      const iface = new ethers.utils.Interface(abi);

      // lock
      const recipientLockscript = "0x00";
      const sudtExtraData = "0x01";
      const amount = ethers.utils.parseEther("0.1");
      const res = await forceBridge.lockETH(
        recipientLockscript,
        sudtExtraData,
        {
          value: amount,
        }
      );

      const receipt = await waitingForReceipt(provider, res);
      console.dir(receipt, { depth: null });
      const parsedLog = iface.parseLog(receipt.logs[0]);

      expect(parsedLog.args.token).to.equal(
        "0x0000000000000000000000000000000000000000"
      );
      expect(parsedLog.args.lockedAmount).to.equal(amount);
      expect(parsedLog.args.sudtExtraData).to.equal(sudtExtraData);
      expect(parsedLog.args.recipientLockscript).to.equal(recipientLockscript);

      // unlock
      const records = [
        {
          token: "0x0000000000000000000000000000000000000000",
          recipient: "0x1000000000000000000000000000000000000001",
          amount: ethers.utils.parseEther("0.06"),
          ckbTxHash: "0x1000000000000000000000000000000000000008",
        },
        {
          token: "0x0000000000000000000000000000000000000000",
          recipient: "0x1000000000000000000000000000000000000002",
          amount: ethers.utils.parseEther("0.04"),
          ckbTxHash: "0x1000000000000000000000000000000000000009",
        },
      ];

      const msgHash = getUnlockMsgHash(
        DOMAIN_SEPARATOR,
        unlockTypeHash,
        records
      );

      console.log("msg hash ", msgHash);
      // 2. generate signatures
      let signatures = generateSignatures(
        msgHash,
        wallets.slice(0, multisigThreshold)
      );

      const resUnlock = await forceBridge.unlock(records, signatures);

      const receiptUnlock = await waitingForReceipt(provider, resUnlock);
      // console.dir(receiptUnlock, {depth: null});
      const unlockLogs = receiptUnlock.logs.map((l) => iface.parseLog(l).args);
      // console.dir(unlockLogs, {depth: null});
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        const res = unlockLogs[i];
        expect(r.recipient).to.equal(res.recipient);
        expect(r.token).to.equal(res.token);
        expect(r.amount).to.equal(res.receivedAmount);
        expect(r.ckbTxHash).to.equal(res.ckbTxHash);
      }
    });
    it("should change validators", async function () {
      const newWallets = generateWallets(7);
      newValidators = newWallets.map((wallet) => wallet.address);
      newMultisigThreshold = 6;

      const msgHash = getChangeValidatorsMsgHash(
        DOMAIN_SEPARATOR,
        unlockTypeHash,
        newValidators,
        newMultisigThreshold
      );

      // 2. generate signatures
      let signatures = generateSignatures(msgHash, wallets.slice(0, 7));

      const result = await forceBridge.changeValidators(
        newValidators,
        newMultisigThreshold,
        signatures
      );
      console.log("changeValidators result", result);
      expect(await forceBridge.multisigThreshold_()).to.equal(
        newMultisigThreshold
      );
    });
  });
});
