import goto from "./goto";

const pageName = "getAssetList.html";
beforeEach(async () => {
  await goto.goto(page, pageName);
});

describe("getAssetList", () => {
  const res = {
    jsonrpc: "2.0",
    id: 3,
    result: [
      {
        network: "Ethereum",
        ident: "0x0000000000000000000000000000000000000000",
        info: {
          decimals: 18,
          name: "ETH",
          symbol: "ETH",
          logoURI: "https://cryptologos.cc/logos/ethereum-eth-logo.svg?v=002",
          shadow: {
            network: "Nervos",
            ident: expect.any(String),
          },
        },
      },
      {
        network: "Ethereum",
        ident: "0x7Af456bf0065aADAB2E6BEc6DaD3731899550b84",
        info: {
          decimals: 18,
          name: "DAI",
          symbol: "DAI",
          logoURI: "https://cryptologos.cc/logos/single-collateral-dai-sai-logo.svg?v=002",
          shadow: {
            network: "Nervos",
            ident: expect.any(String),
          },
        },
      },
      {
        network: "Ethereum",
        ident: "0x74a3dbd5831f45CD0F3002Bb87a59B7C15b1B5E6",
        info: {
          decimals: 6,
          name: "USDT",
          symbol: "USDT",
          logoURI: "https://cryptologos.cc/logos/tether-usdt-logo.svg?v=002",
          shadow: {
            network: "Nervos",
            ident: expect.any(String),
          },
        },
      },
      {
        network: "Ethereum",
        ident: "0x265566D4365d80152515E800ca39424300374A83",
        info: {
          decimals: 6,
          name: "USDC",
          symbol: "USDC",
          logoURI: "https://cryptologos.cc/logos/usd-coin-usdc-logo.svg?v=002",
          shadow: {
            network: "Nervos",
            ident: expect.any(String),
          },
        },
      },
      {
        network: "Nervos",
        ident: "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        info: {
          decimals: 8,
          name: "CKB",
          symbol: "CKB",
          logoURI: "",
          shadow: {
            network: "Ethereum",
            ident: expect.any(String),
          },
        },
      },
      {
        network: "Nervos",
        ident: "0x33ccf0d1d3ff3c58c1afacf3d1a5ae8d68a06b27b8dbfd86625cef1fcbfbaf67",
        info: {
          decimals: 8,
          name: "DEV_TOKEN",
          symbol: "DEV_TOKEN",
          logoURI: "",
          shadow: {
            network: "Ethereum",
            ident: expect.any(String),
          },
        },
      },
    ],
  };
  it("getAssetList_1", async () => {
    const param1 = await page.$(goto.pageIds.param1Id);
    await param1.type("all");
    await goto.checkObject(page, res);
  });

  /**
  * more params
  */
  it("getAssetList_2", async () => {
    const testType = await page.$(goto.pageIds.testTypeId);
    await testType.type("2"); // 0: none params 1: common params to request 2: more params
    await goto.checkObject(page, res);
  });

  /**
  * none params
  */
  it("getAssetList_3", async () => {
    const testType = await page.$(goto.pageIds.testTypeId);
    await testType.type("0"); // 0: none params 1: common params to request 2: more params
    await goto.checkObject(page, res);
  });
});
