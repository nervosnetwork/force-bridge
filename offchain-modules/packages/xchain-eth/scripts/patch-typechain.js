// there is an error on typechain when targeting to ethers-v5
// we should replace ethers-v4's BaseContract with ethers-v5's Contract

const fs = require('fs');
const path = require('path');

function patch(dtsPath) {
  const origin = fs.readFileSync(dtsPath).toString();
  const patched = origin.replace(/BaseContract/g, 'Contract');

  fs.writeFileSync(dtsPath, Buffer.from(patched));
}

function main() {
  patch(path.join(__dirname, '../src/generated/contracts/ForceBridge/ForceBridge.d.ts'));
  patch(path.join(__dirname, '../src/generated/contracts/AssetManager/AssetManager.d.ts'));

  console.log('typechain was patched');
}

main();
