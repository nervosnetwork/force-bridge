import goto from "./goto";

const pageName = "getBalance.html";
beforeEach(async () => {
  await goto.goto(page, pageName);
});

describe("getBalance", () => {
  it("getBalance_1", async () => {
    const res = {
      jsonrpc: "2.0",
      id: 4,
      result: [
        {
          network: "Ethereum",
          ident: "0x0000000000000000000000000000000000000000",
          amount: expect.anything(),
        },
        {
          network: "Ethereum",
          ident: "0x7Af456bf0065aADAB2E6BEc6DaD3731899550b84",
          amount: "0",
        },
      ],
    };
    const param1 = await page.$(goto.pageIds.param1Id);
    const param2 = await page.$(goto.pageIds.param2Id);
    const param3 = await page.$(goto.pageIds.param3Id);
    const param4 = await page.$(goto.pageIds.param4Id);
    const param5 = await page.$(goto.pageIds.param5Id);
    const param6 = await page.$(goto.pageIds.param6Id);
    await param1.type("Ethereum");
    await param2.type("0xb7abd784a77c307797844136eb2f2a67325e2486");
    await param3.type("0x0000000000000000000000000000000000000000");
    await param4.type("Ethereum");
    await param5.type("0xb7abd784a77c307797844136eb2f2a67325e2486");
    await param6.type("0x7Af456bf0065aADAB2E6BEc6DaD3731899550b84");
    await goto.checkObject(page, res);
  }, goto.longTimeOut);

  /**
  * more params
  */
  it("getBalance_2", async () => {
    const testType = await page.$(goto.pageIds.testTypeId);
    await testType.type("2"); // 0: none params 1: common params to request 2: more params
    await goto.checkObject(page, goto.paraErrorRes);
  });

  /**
  * none params
  */
  it("getBalance_3", async () => {
    const testType = await page.$(goto.pageIds.testTypeId);
    await testType.type("0"); // 0: none params 1: common params to request 2: more params
    await goto.checkObject(page, goto.paraErrorRes);
  });
});
