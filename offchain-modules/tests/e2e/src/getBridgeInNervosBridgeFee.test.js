import goto from "./goto";

const pageName = "getBridgeInNervosBridgeFee.html";
beforeEach(async () => {
  await goto.goto(page, pageName);
});

describe("getBridgeInNervosBridgeFee", () => {
  it("getBridgeInNervosBridgeFee_1", async () => {
    const res = {
      jsonrpc: "2.0",
      id: 6,
      result: {
        fee: {
          network: "Nervos",
          // "ident": "0x1b072aa0ded384067106ea0c43c85bd71bafa5afdb432123511da46b390a4e33",
          ident: "0x50d924cb177468db13acd3516b9eefddf1cc5df94a684432bcb6a48aeb737b8b",
          amount: "1000000000000",
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
  it("getBridgeInNervosBridgeFee_2", async () => {
    const testType = await page.$(goto.pageIds.testTypeId);
    await testType.type("2"); // 0: none params 1: common params to request 2: more params
    await goto.checkObject(page, goto.paraErrorRes);
  });

  /**
  * none params
  */
  it("getBridgeInNervosBridgeFee_3", async () => {
    const testType = await page.$(goto.pageIds.testTypeId);
    await testType.type("0"); // 0: none params 1: common params to request 2: more params
    await goto.checkObject(page, goto.paraErrorRes);
  });
});
