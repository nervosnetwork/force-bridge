import goto from "./goto";

const pageName = "generateBridgeNervosToXchainLockTx.html";
beforeEach(async () => {
  await goto.goto(page, pageName);
});

describe("generateBridgeNervosToXchainLockTx", () => {
  it("generateBridgeNervosToXchainLockTx_1", async () => {
    const res = {
      jsonrpc: "2.0",
      id: 60,
      result: {
        network: "Nervos",
        rawTransaction: {
          cellProvider: {
            ckbRpcUrl: "https://testnet.ckb.dev/rpc",
            ckbIndexerUrl: "https://testnet.ckb.dev/indexer",
            uri: "https://testnet.ckb.dev/rpc",
          },
          cellDeps: [
            {
              out_point: {
                tx_hash: "0xd438e7fbab5da143b9bae607dac0cad482b8f38b3ac579276dd0da285ac5cdd2",
                index: "0x0",
              },
              dep_type: "code",
            },
            {
              out_point: {
                tx_hash: "0xf8de3bb47d055cdf460d93a2a6e1b05f7432f9777c8c474abf4eec1d4aee5d37",
                index: "0x0",
              },
              dep_type: "dep_group",
            },
          ],
          headerDeps: [],
          inputs: [
            {
              cell_output: {
                capacity: "0xe8d4a5020e",
                lock: {
                  args: "0x01888905e586e70d47c2ea0aa68452efafed96888800",
                  code_hash: "0xea5d73e46455979b498e7c6eb4eb88af285ad474c3a7eab98d16e0d9210d56f1",
                  hash_type: "data",
                },
                type: null,
              },
              data: "0x",
              out_point: {
                index: "0x0",
                tx_hash: "0x6e573f475335e670296eba51c0bb9703e2cc535e3194b9d5319d69079bbd3efc",
              },
              block_number: "0x5116ce",
            },
          ],
          outputs: [
            {
              cell_output: {
                capacity: "0x1bf08eb000",
                lock: {
                  code_hash: "0xea5d73e46455979b498e7c6eb4eb88af285ad474c3a7eab98d16e0d9210d56f1",
                  hash_type: "data",
                  args: "0x00000000000000000000000000000000000000000001e4e069c48e810d94a6a40e6f6031f7f8e7bae71b5fb8e2ef9701e38631b0a968",
                },
              },
              data: "0x",
            },
            {
              cell_output: {
                capacity: "0xcce4163a8a",
                lock: {
                  code_hash: "0xea5d73e46455979b498e7c6eb4eb88af285ad474c3a7eab98d16e0d9210d56f1",
                  hash_type: "data",
                  args: "0x01888905e586e70d47c2ea0aa68452efafed96888800",
                },
              },
              data: "0x",
            },
          ],
          witnesses: [
            "0x690000001000000069000000690000005500000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
            "0x250000000c0000000d0000000114000000888905e586e70d47c2ea0aa68452efafed968888",
          ],
          fixedEntries: [],
          signingEntries: [
            {
              type: "witness_args_lock",
              index: 0,
              message: "0xb8d04b07adf92ba6f5c001dad367532735a761793d890784cdcfcb3b01a87a0d",
            },
          ],
          inputSinces: {},
        },
      },
    };
    const param1 = await page.$(goto.pageIds.param1Id);
    const param2 = await page.$(goto.pageIds.param2Id);
    const param3 = await page.$(goto.pageIds.param3Id);
    const param4 = await page.$(goto.pageIds.param4Id);
    const param5 = await page.$(goto.pageIds.param5Id);
    await param1.type("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
    await param2.type("100000000000");
    await param3.type("Ethereum");
    await param4.type("0x888905E586E70d47C2Ea0aA68452efAFed968888");
    await param5.type("ckt1qr496ulyv32e0x6f3e7xad8t3zhjskk5wnp6064e35twpkfpp4t0zqqp3zystevxuux50sh2p2ngg5h04lkedzygqqemewls");
    await goto.check(page, JSON.stringify(res));
  }, goto.longTimeOut);

  /**
  * more params
  */
  it("generateBridgeNervosToXchainLockTx_2", async () => {
    const testType = await page.$(goto.pageIds.testTypeId);
    await testType.type("2"); // 0: none params 1: common params to request 2: more params
    await goto.checkObject(page, goto.paraErrorRes);
  });

  /**
  * none params
  */
  it("generateBridgeNervosToXchainLockTx_3", async () => {
    const testType = await page.$(goto.pageIds.testTypeId);
    await testType.type("0"); // 0: none params 1: common params to request 2: more params
    await goto.checkObject(page, goto.paraErrorRes);
  });
});
