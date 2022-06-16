import goto from "./goto";

const pageName = "getBridgeOutNervosBridgeFee.html";
beforeEach(async () => {
  await goto.goto(page, pageName);
});

describe("getBridgeOutNervosBridgeFee", () => {
  it("getBridgeOutNervosBridgeFee_1", async () => {
    const res = {
      jsonrpc: "2.0",
      id: 7,
      result: {
        fee: {
          network: "Ethereum",
          ident: "0x0000000000000000000000000000000000000000",
          amount: "2000000000000",
        },
      },
    };
    const param1 = await page.$(goto.pageIds.param1Id);
    const param2 = await page.$(goto.pageIds.param2Id);
    const param3 = await page.$(goto.pageIds.param3Id);
    await param1.type("Ethereum");
    await param2.type("100000000000000");
    await param3.type("0x0000000000000000000000000000000000000000");
    await goto.check(page, JSON.stringify(res));
  });

  /**
  * more params
  */
  it("getBridgeOutNervosBridgeFee_2", async () => {
    const testType = await page.$(goto.pageIds.testTypeId);
    await testType.type("2"); // 0: none params 1: common params to request 2: more params
    await goto.checkObject(page, goto.paraErrorRes);
  });

  /**
  * none params
  */
  it("getBridgeOutNervosBridgeFee_3", async () => {
    const testType = await page.$(goto.pageIds.testTypeId);
    await testType.type("0"); // 0: none params 1: common params to request 2: more params
    await goto.checkObject(page, goto.paraErrorRes);
  });
});
