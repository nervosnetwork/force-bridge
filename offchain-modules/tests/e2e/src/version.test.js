import goto from "./goto";

const pageName = "version.html";
beforeEach(async () => {
  await goto.goto(page, pageName);
});

describe("version", () => {
  it("version_1", async () => {
    const res = {
      jsonrpc: "2.0",
      id: 10,
      result: expect.anything(),
    };
    await goto.checkObject(page, res);
  });
});
