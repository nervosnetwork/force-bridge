import goto from "./goto";

const pageName = "getBridgeNervosToXchainBurnBridgeFee.html";
beforeEach(async () => {
  await goto.goto(page, pageName);
});

describe("getBridgeNervosToXchainBurnBridgeFee", () => {
  it("getBridgeNervosToXchainBurnBridgeFee_1", async () => {
    const res = {
      jsonrpc: "2.0",
      id: 145,
      result: {
        xchain: "Ethereum",
        amount: "20000000000",
      },
    };
    const param1 = await page.$(goto.pageIds.param1Id);
    const param2 = await page.$(goto.pageIds.param2Id);
    const param3 = await page.$(goto.pageIds.param3Id);
    await param1.type("Ethereum");
    await param2.type("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
    await param3.type("100000000000");
    await goto.check(page, JSON.stringify(res));
  });

  /**
  * more params
  */
  it("getBridgeNervosToXchainBurnBridgeFee_2", async () => {
    const testType = await page.$(goto.pageIds.testTypeId);
    await testType.type("2"); // 0: none params 1: common params to request 2: more params
    await goto.checkObject(page, goto.paraErrorRes);
  });

  /**
  * none params
  */
  it("getBridgeNervosToXchainBurnBridgeFee_3", async () => {
    const testType = await page.$(goto.pageIds.testTypeId);
    await testType.type("0"); // 0: none params 1: common params to request 2: more params
    await goto.checkObject(page, goto.paraErrorRes);
  });
});
