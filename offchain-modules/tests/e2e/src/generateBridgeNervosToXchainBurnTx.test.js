import goto from "./goto";

const pageName = "generateBridgeNervosToXchainBurnTx.html";
beforeEach(async () => {
  await goto.goto(page, pageName);
});

describe("generateBridgeNervosToXchainBurnTx", () => {
  it("generateBridgeNervosToXchainBurnTx_1", async () => {
    const res = {
      jsonrpc: "2.0",
      id: 110,
      result: {
        network: "Ethereum",
        rawTransaction: {
          data: "0x190a6aa90000000000000000000000009c8ccf938883a427b90aef5155284cfbcaceecc6000000000000000000000000000000000000000000000000000000174876e800000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000001200000000000000000000000000000000000000000000000000000000000000064636b74317172343936756c7976333265307836663365377861643874337a686a736b6b35776e70363036346533357477706b6670703474307a717170337a797374657678757578353073683270326e6767356830346c6b65647a79677171656d65776c73000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
          to: "0x5e0fAbAC41Bf9348016fAd50ed48e9c7ce0DB99e",
          value: {
            type: "BigNumber",
            hex: "0x04a817c800",
          },
        },
      },
    };
    const param1 = await page.$(goto.pageIds.param1Id);
    const param2 = await page.$(goto.pageIds.param2Id);
    const param3 = await page.$(goto.pageIds.param3Id);
    const param4 = await page.$(goto.pageIds.param4Id);
    const param5 = await page.$(goto.pageIds.param5Id);
    await param1.type("0x9C8CCf938883a427b90aEf5155284cFbcAceECC6");
    await param2.type("100000000000");
    await param3.type("Ethereum");
    await param4.type("ckt1qr496ulyv32e0x6f3e7xad8t3zhjskk5wnp6064e35twpkfpp4t0zqqp3zystevxuux50sh2p2ngg5h04lkedzygqqemewls");
    await param5.type("0x888905e586e70d47c2ea0aa68452efafed968888");
    await goto.check(page, JSON.stringify(res));
  });

  /**
  * more params
  */
  it("generateBridgeNervosToXchainBurnTx_2", async () => {
    const testType = await page.$(goto.pageIds.testTypeId);
    await testType.type("2"); // 0: none params 1: common params to request 2: more params
    await goto.checkObject(page, goto.paraErrorRes);
  });

  /**
  * none params
  */
  it("generateBridgeNervosToXchainBurnTx_3", async () => {
    const testType = await page.$(goto.pageIds.testTypeId);
    await testType.type("0"); // 0: none params 1: common params to request 2: more params
    await goto.checkObject(page, goto.paraErrorRes);
  });
});
