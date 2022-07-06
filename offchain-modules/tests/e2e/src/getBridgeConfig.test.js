import goto from "./goto";

const pageName = "getBridgeConfig.html";
beforeEach(async () => {
  await goto.goto(page, pageName);
});

describe("getBridgeConfig", () => {
  it("getBridgeConfig_1", async () => {
    const res = {
      jsonrpc: "2.0",
      id: 5,
      result: {
        nervos: {
          network: "testnet",
          confirmNumber: 15,
          omniLockCodeHash: "0xea5d73e46455979b498e7c6eb4eb88af285ad474c3a7eab98d16e0d9210d56f1",
          omniLockHashType: "data",
        },
        xchains: {
          Ethereum: {
            contractAddress: expect.any(String),
            confirmNumber: 12,
          },
        },
      },
    };
    await goto.checkObject(page, res);
  });
});
