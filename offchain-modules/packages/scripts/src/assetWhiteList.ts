import * as fs from 'fs';
import { utils } from '@ckb-lumos/base';
import { EthAsset } from '@force-bridge/x/dist/ckb/model/asset';
import { WhiteListEthAsset } from '@force-bridge/x/dist/config';
import { writeJsonToFile } from '@force-bridge/x/dist/utils';
import { getAssetAVGPrice, getClosestNumber } from '@force-bridge/x/dist/utils/price';
import { BigNumber } from 'bignumber.js';

export interface Token {
  address: string;
  name: string;
  symbol: string;
  logoURI: string;
  decimal: number;
}

export interface WhiteListEthAssetExtend extends WhiteListEthAsset {
  sudtArgs: string;
}

const BRIDGE_IN_CKB_FEE = 400; // 400CKB
const BRIDGE_OUT_ETH_FEE = 0.015; // 15W gas * 100Gwei

async function getBridgeInFeeInUSDT(): Promise<BigNumber> {
  const price = await getAssetAVGPrice('CKB');
  return new BigNumber(price).times(BRIDGE_IN_CKB_FEE);
}

async function getBridgeOutFeeInUSDT(): Promise<BigNumber> {
  const price = await getAssetAVGPrice('ETH');
  return new BigNumber(price).times(BRIDGE_OUT_ETH_FEE);
}

//  eslint-disable-next-line @typescript-eslint/no-unused-vars
async function generateWhiteList(inPath: string, outPath: string): Promise<void> {
  const tokens: Token[] = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const assetWhiteList: WhiteListEthAsset[] = [];
  let price = new BigNumber(1);
  const bridgeInFee = await getBridgeInFeeInUSDT();
  const bridgeOutFee = await getBridgeOutFeeInUSDT();
  for (const token of tokens) {
    if (['USDT', 'DAI'].includes(token.symbol)) {
      price = new BigNumber(1);
    } else {
      price = new BigNumber(await getAssetAVGPrice(token.symbol));
    }
    const baseAmount = new BigNumber(Math.pow(10, token.decimal)).div(new BigNumber(price));
    const minimalBridgeAmount = baseAmount.times(2).multipliedBy(bridgeOutFee).toFixed(0);
    const inAmount = baseAmount.multipliedBy(new BigNumber(bridgeInFee)).toFixed(0);
    const outAmount = baseAmount.multipliedBy(new BigNumber(bridgeOutFee)).toFixed(0);

    const assetInfo: WhiteListEthAssetExtend = {
      ...token,
      minimalBridgeAmount: getClosestNumber(minimalBridgeAmount),
      bridgeFee: { in: getClosestNumber(inAmount), out: getClosestNumber(outAmount) },
      sudtArgs: addressToSudtArgs(token.address),
    };
    assetWhiteList.push(assetInfo);
    console.log(`info: ${JSON.stringify(assetInfo)}, price: ${price}`);
  }
  writeJsonToFile(assetWhiteList, outPath);
}

function addressToSudtArgs(address: string): string {
  // mainnet config
  const ownerCellTypeHash = utils.computeScriptHash({
    code_hash: '0x00000000000000000000000000000000000000000000000000545950455f4944',
    hash_type: 'type',
    args: '0x36a3a692465d2fd3e855078280cba526d90c8b5c98c5da1c1f4430e1086ca602',
  });
  const bridgeLockscript = {
    code_hash: '0x93bc7a915d3d8f8b9678bc6c7a1751738c99ce6e66bba4dfab56672f6d691789',
    hash_type: 'type' as 'type' | 'data',
    args: new EthAsset(address, ownerCellTypeHash).toBridgeLockscriptArgs(),
  };
  const sudtArgs = utils.computeScriptHash(bridgeLockscript);
  return sudtArgs;
}

async function main() {
  await generateWhiteList('../configs/raw-mainnet-asset-white-list.json', '../configs/mainnet-asset-white-list.json');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`generate asset white list failed, error: ${error.stack}`);
    process.exit(1);
  });
