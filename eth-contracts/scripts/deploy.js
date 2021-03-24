// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
const { Wallet } = require("ethers");
const hre = require("hardhat");
const nconf = require("nconf");

async function main() {
  const configPath =
    process.env.CONFIG_PATH || "../offchain-modules/config.json";
  nconf.env().file({ file: configPath });

  const ForceBridge = await ethers.getContractFactory("ForceBridge");
  const bridge = await ForceBridge.deploy();
  await bridge.deployed();
  nconf.set("forceBridge:eth:contractAddress", bridge.address);
  nconf.save();

  const multiSignKeys = nconf.get("forceBridge:eth:multiSignKeys");
  const wallets = multiSignKeys.map((key) => new ethers.Wallet(key));
  const validators = wallets.map((wallet) => wallet.address);

  const multiSignThreshold = nconf.get("forceBridge:eth:multiSignThreshold");
  await bridge.initialize(validators, multiSignThreshold);

  console.log(
    `ForceBridge deployed to: ${bridge.address}, admin: ${await bridge.admin()}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
