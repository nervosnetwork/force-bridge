import goto from "./goto";

const pageName = "generateBridgeOutNervosTransaction.html";
beforeEach(async () => {
  await goto.goto(page, pageName);
});

describe("generateBridgeOutNervosTransaction", () => {
  it("generateBridgeOutNervosTransaction_1", async () => {
    const res = {
      jsonrpc: "2.0",
      id: 2,
      result: {
        network: "Nervos",
        rawTransaction: {
          cellProvider: {
            ckbRpcUrl: "http://fb-ckb-testnet-svc:8114/rpc",
            ckbIndexerUrl: "http://fb-ckb-testnet-svc:8114/indexer",
            uri: "http://fb-ckb-testnet-svc:8114/rpc",
          },
          cellDeps: [
            {
              out_point: {
                tx_hash: "0xf8de3bb47d055cdf460d93a2a6e1b05f7432f9777c8c474abf4eec1d4aee5d37",
                index: "0x0",
              },
              dep_type: "dep_group",
            },
            expect.anything(),
          ],
          headerDeps: [],
          inputs: expect.anything(),
          outputs: expect.anything(),
          witnesses: [],
          fixedEntries: [],
          signingEntries: [],
          inputSinces: {},
        },
      },
    };
    const param1 = await page.$(goto.pageIds.param1Id);
    const param2 = await page.$(goto.pageIds.param2Id);
    const param3 = await page.$(goto.pageIds.param3Id);
    const param4 = await page.$(goto.pageIds.param4Id);
    const param5 = await page.$(goto.pageIds.param5Id);
    await param1.type("Ethereum");
    await param2.type("100000000000000");
    await param3.type("0x0000000000000000000000000000000000000000");
    await param4.type("0xB7ABd784a77c307797844136eB2F2A67325E2486");
    await param5.type("ckt1qpvvtay34wndv9nckl8hah6fzzcltcqwcrx79apwp2a5lkd07fdxxqdh40tcffmuxpme0pzpxm4j72n8xf0zfps55h68c");
    await goto.checkObject(page, res);
  }, goto.longTimeOut);

  it("generateBridgeOutNervosTransaction_2", async () => {
    const res = {
      jsonrpc: "2.0",
      id: 2,
      error: {
        code: 0,
        message: "sudt amount is not enough!",
      },
    };
    const param1 = await page.$(goto.pageIds.param1Id);
    const param2 = await page.$(goto.pageIds.param2Id);
    const param3 = await page.$(goto.pageIds.param3Id);
    const param4 = await page.$(goto.pageIds.param4Id);
    const param5 = await page.$(goto.pageIds.param5Id);
    await param1.type("Ethereum");
    await param2.type("900000000000000");
    await param3.type("0x0000000000000000000000000000000000000000");
    await param4.type("0xB7ABd784a77c307797844136eB2F2A67325E2486");
    await param5.type("ckt1qpvvtay34wndv9nckl8hah6fzzcltcqwcrx79apwp2a5lkd07fdxxqdh40tcffmuxpme0pzpxm4j72n8xf0zfps55h68c");
    await goto.check(page, JSON.stringify(res));
  }, goto.longTimeOut);

  /**
  * more params
  */
  it("generateBridgeOutNervosTransaction_3", async () => {
    const testType = await page.$(goto.pageIds.testTypeId);
    await testType.type("2"); // 0: none params 1: common params to request 2: more params
    await goto.checkObject(page, goto.paraErrorRes);
  });

  /**
  * none params
  */
  it("generateBridgeOutNervosTransaction_4", async () => {
    const testType = await page.$(goto.pageIds.testTypeId);
    await testType.type("0"); // 0: none params 1: common params to request 2: more params
    await goto.checkObject(page, goto.paraErrorRes);
  });
});
