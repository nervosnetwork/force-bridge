// there is an error on typechain when targeting to ethers-v5
// we should replace ethers-v4's BaseContract with ethers-v5's Contract

const fs = require('fs');
const path = require('path');

function main() {
  const dtsPath = path.join(__dirname, '../src/generated/contract/ForceBridge.d.ts');
  const origin = fs.readFileSync(dtsPath).toString();
  const patched = origin.replace(/BaseContract/g, 'Contract');

  fs.writeFileSync(dtsPath, Buffer.from(patched));

  console.log('typechain was patched');
}

main();
