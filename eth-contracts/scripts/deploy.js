// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
const { Wallet } = require('ethers');
const hre = require('hardhat');
const nconf = require('nconf');
const path = require('path');
const fs = require('fs');

function getFromEnv(key, defaultValue) {
  let value = process.env[key];
  if(value !== undefined) {
    return value;
  }
  if(defaultValue !== undefined) {
    return defaultValue;
  } else {
    throw new Error(`${key} not provided in ENV`);
  }
}

function writeJsonToFile(obj, writePath) {
  const data = JSON.stringify(obj, null, 2);
  const dir = path.dirname(writePath);
  if(!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(writePath, data);
}

async function main() {
  const configPath = getFromEnv("MULTISIG_CONFIG_PATH");
  nconf.file({ file: configPath });

  const validators = nconf.get('forceBridge:eth:multiSignAddresses');
  const multiSignThreshold = nconf.get('forceBridge:eth:multiSignThreshold');
  const ForceBridge = await ethers.getContractFactory('ForceBridge');
  console.dir({validators, multiSignThreshold});
  const bridge = await ForceBridge.deploy(validators, multiSignThreshold);
  await bridge.deployed();
  const eth_node = process.env.ETH_URL || 'http://127.0.0.1:8545';
  const provider = ethers.getDefaultProvider(eth_node);
  const blockNumber = await provider.getBlockNumber();
  const obj = {
    forceBridge: {
      eth: {
        startBlockHeight: blockNumber,
        contractAddress: bridge.address,
      }
    }
  }
  const outputConfigPath = getFromEnv("CONFIG_PATH", '/tmp/force-bridge');
  const ethContractConfig = `${outputConfigPath}/eth_contract_config.json`;
  writeJsonToFile(obj, ethContractConfig);

  console.log(`ForceBridge deployed to: ${bridge.address}`);
  console.log(`config wriiten to: ${ethContractConfig}`)
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
