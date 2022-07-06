import goto from "./goto";

const pageName = "getMinimalBridgeAmount.html";
beforeEach(async () => {
  await goto.goto(page, pageName);
});

describe("getMinimalBridgeAmount", () => {
  it("getMinimalBridgeAmount_1", async () => {
    const res = {
      jsonrpc: "2.0",
      id: 9,
      result: {
        minimalAmount: "10000000000000",
      },
    };
    const param1 = await page.$(goto.pageIds.param1Id);
    const param2 = await page.$(goto.pageIds.param2Id);
    await param1.type("Ethereum");
    await param2.type("0x0000000000000000000000000000000000000000");
    await goto.check(page, JSON.stringify(res));
  });

  /**
  * more params
  */
  it("getMinimalBridgeAmount_2", async () => {
    const testType = await page.$(goto.pageIds.testTypeId);
    await testType.type("2"); // 0: none params 1: common params to request 2: more params
    await goto.checkObject(page, goto.paraErrorRes);
  });

  /**
  * none params
  */
  it("getMinimalBridgeAmount_3", async () => {
    const testType = await page.$(goto.pageIds.testTypeId);
    await testType.type("0"); // 0: none params 1: common params to request 2: more params
    await goto.checkObject(page, goto.paraErrorRes);
  });
});
