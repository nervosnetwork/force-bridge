const { expect } = require("chai");
const { waitingForReceipt } = require("./utils");

describe("ForceBridge", function() {
    it("should work well for lock and unlock ETH", async function() {
        const abi = require('../artifacts/contracts/ForceBridge.sol/ForceBridge.json').abi;
        // console.dir(abi, {depth: null});
        const iface = new ethers.utils.Interface(abi);

        // deploy
        const ForceBridge = await ethers.getContractFactory("ForceBridge");
        const bridge = await ForceBridge.deploy();
        await bridge.deployed();
        console.log("ForceBridge deployed to:", bridge.address);
        const provider = bridge.provider;

        // lock
        const recipientLockscript = '0x00';
        const sudtExtraData = '0x01';
        const amount = ethers.utils.parseEther("0.1");
        const res = await bridge.lockETH(
            recipientLockscript,
            sudtExtraData,
            { value: amount },
        );

        const receipt = await waitingForReceipt(provider, res);
        // console.log(`gasUsed: ${receipt.gasUsed.toString()}`);
        console.dir(receipt, {depth: null});
        const parsedLog = iface.parseLog(receipt.logs[0]);
        // console.dir(parsedLog.args, {depth: null});

        expect(parsedLog.args.token).to.equal(
            '0x0000000000000000000000000000000000000000'
        );
        expect(parsedLog.args.lockedAmount).to.equal(amount);
        expect(parsedLog.args.sudtExtraData).to.equal(sudtExtraData);
        expect(parsedLog.args.recipientLockscript).to.equal(recipientLockscript);
        // const balance = await provider.getBalance(bridge.address);
        // console.log(`contract balance: ${balance}`);

        // unlock
        const records = [
            {
                token: '0x0000000000000000000000000000000000000000',
                recipient: '0x1000000000000000000000000000000000000001',
                amount: ethers.utils.parseEther("0.06"),
            },
            {
                token: '0x0000000000000000000000000000000000000000',
                recipient: '0x1000000000000000000000000000000000000002',
                amount: ethers.utils.parseEther("0.04"),
            },
        ]
        const resUnlock = await bridge.unlock(records);

        const receiptUnlock = await waitingForReceipt(provider, resUnlock);
        // console.dir(receiptUnlock, {depth: null});
        const unlockLogs = receiptUnlock.logs.map(l => iface.parseLog(l).args);
        // console.dir(unlockLogs, {depth: null});
        for(let i=0; i<records.length; i++) {
            const r = records[i];
            const res = unlockLogs[i];
            expect(r.recipient).to.equal(res.recipient);
            expect(r.token).to.equal(res.token);
            expect(r.amount).to.equal(res.receivedAmount);
        }
    });
});
