import goto from "./goto";

const pageName = "getBridgeTransactionSummaries.html";
beforeEach(async () => {
  await goto.goto(page, pageName);
});

describe("getBridgeTransactionSummaries", () => {
  it("getBridgeTransactionSummaries_1", async () => {
    const res = {
      jsonrpc: "2.0",
      id: 8,
      result: expect.anything(),
    };
    const param1 = await page.$(goto.pageIds.param1Id);
    const param2 = await page.$(goto.pageIds.param2Id);
    const param3 = await page.$(goto.pageIds.param3Id);
    const param4 = await page.$(goto.pageIds.param4Id);
    await param1.type("Ethereum");
    await param2.type("0x0000000000000000000000000000000000000000");
    await param3.type("Nervos");
    await param4.type("ckt1qpvvtay34wndv9nckl8hah6fzzcltcqwcrx79apwp2a5lkd07fdxxqdh40tcffmuxpme0pzpxm4j72n8xf0zfps55h68c");
    await goto.checkObject(page, res);
  });

  /**
  * more params
  */
  it("getBridgeTransactionSummaries_2", async () => {
    const testType = await page.$(goto.pageIds.testTypeId);
    await testType.type("2"); // 0: none params 1: common params to request 2: more params
    await goto.checkObject(page, goto.paraErrorRes);
  });

  /**
  * none params
  */
  it("getBridgeTransactionSummaries_3", async () => {
    const testType = await page.$(goto.pageIds.testTypeId);
    await testType.type("0"); // 0: none params 1: common params to request 2: more params
    await goto.checkObject(page, goto.paraErrorRes);
  });
});
