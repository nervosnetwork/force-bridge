import * as fs from 'fs';
import { utils } from '@ckb-lumos/base';
import { EthAsset } from '@force-bridge/x/dist/ckb/model/asset';
import { WhiteListEthAsset } from '@force-bridge/x/dist/config';
import { writeJsonToFile } from '@force-bridge/x/dist/utils';
import { getAssetAVGPrice, getClosestNumber } from '@force-bridge/x/dist/utils/price';
import { BigNumber } from 'bignumber.js';
import { ethers } from 'ethers';

export type Bridge = 'ForceBridge';
export type Network = 'Ethereum' | 'BSC';
export type NetworkSymbol = 'eth' | 'bsc';

export interface Token {
  address: string;
  name: string;
  symbol: string;
  logoURI: string;
  decimal: number;
}

export interface WhiteListPublic {
  address: string;
  name: string;
  symbol: string;
  logoURI: string;
  decimal: number;
  sudtArgs: string;
  source: Network;
  bridge: Bridge;
  ckbExplorerUrl: string;
  ckbL2ContractAddress: string;
}

const BRIDGE_IN_CKB_FEE = 400; // 400CKB
const BRIDGE_OUT_ETH_FEE = 0.012; // 150000 gas * 80 Gwei (*10^9/10^18)
const TOKEN_PRICE_MAPPING = {
  WBTC: 'BTC',
  BTCB: 'BTC',
  WBNB: 'BNB',
};
// used for tokens can not find price in binance API
const TOKEN_PRICE_CONFIG = {
  iBFR: 0.2366,
  BZRX: 0.2334,
};
const CachedCkbL2ContractAddressMap: Map<string, string> = new Map();

async function getBridgeInFeeInUSDT(): Promise<BigNumber> {
  const price = await getAssetAVGPrice('CKB');
  return new BigNumber(price).times(BRIDGE_IN_CKB_FEE);
}

async function getBridgeOutFeeInUSDT(): Promise<BigNumber> {
  const price = await getAssetAVGPrice('ETH');
  return new BigNumber(price).times(BRIDGE_OUT_ETH_FEE);
}

//  eslint-disable-next-line @typescript-eslint/no-unused-vars
async function generateWhiteList(inPath: string, outPath: string, network: Network): Promise<WhiteListPublic[]> {
  const tokens: Token[] = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const assetWhiteList: WhiteListEthAsset[] = [];
  const assetWhitePublicList: WhiteListPublic[] = [];
  let price = new BigNumber(1);
  const bridgeInFee = await getBridgeInFeeInUSDT();
  let bridgeOutFee;
  switch (network) {
    case 'Ethereum':
      bridgeOutFee = await getBridgeOutFeeInUSDT();
      break;
    case 'BSC':
      bridgeOutFee = bridgeInFee;
      break;
    default:
      throw new Error(`unknown network: ${network}`);
  }
  for (const token of tokens) {
    if (['USDT', 'DAI'].includes(token.symbol)) {
      price = new BigNumber(1);
    } else if (TOKEN_PRICE_CONFIG[token.symbol] !== undefined) {
      price = new BigNumber(TOKEN_PRICE_CONFIG[token.symbol]);
    } else if (TOKEN_PRICE_MAPPING[token.symbol] !== undefined) {
      price = new BigNumber(await getAssetAVGPrice(TOKEN_PRICE_MAPPING[token.symbol]));
    } else {
      price = new BigNumber(await getAssetAVGPrice(token.symbol));
    }
    if (price.eq(new BigNumber(0))) {
      throw new Error(`invalid price: ${price.toString()}`);
    }
    const baseAmount = new BigNumber(Math.pow(10, token.decimal)).div(new BigNumber(price));
    const minimalBridgeAmount = baseAmount.times(2).multipliedBy(bridgeOutFee).toFixed(0);
    const inAmount = baseAmount.multipliedBy(new BigNumber(bridgeInFee)).toFixed(0);
    const outAmount = baseAmount.multipliedBy(new BigNumber(bridgeOutFee)).toFixed(0);
    token.address = ethers.utils.getAddress(token.address);

    const assetInfo: WhiteListEthAsset = {
      ...token,
      minimalBridgeAmount: getClosestNumber(minimalBridgeAmount),
      bridgeFee: { in: getClosestNumber(inAmount), out: getClosestNumber(outAmount) },
    };
    assetWhiteList.push(assetInfo);
    console.log(`info: ${JSON.stringify(assetInfo)}, price: ${price}`);
    const networkSymbol: NetworkSymbol = network === 'Ethereum' ? 'eth' : 'bsc';
    const bridge = 'ForceBridge';
    const sudtArgs = addressToSudtArgs(token.address, network);
    const sudtTypeHash = computeSudtTypeHash(sudtArgs);
    const ckbExplorerUrl = `https://explorer.nervos.org/sudt/${sudtTypeHash}`;
    const symbol = `${token.symbol}|${networkSymbol}`;
    const extendAssetInfo: WhiteListPublic = {
      address: token.address,
      symbol,
      name: `Wrapped ${token.symbol} (${bridge} from ${network})`,
      decimal: token.decimal,
      logoURI: token.logoURI,
      sudtArgs,
      source: network,
      bridge,
      ckbExplorerUrl,
      ckbL2ContractAddress: CachedCkbL2ContractAddressMap.get(symbol) || '',
    };
    assetWhitePublicList.push(extendAssetInfo);
  }
  writeJsonToFile(assetWhiteList, outPath);
  return assetWhitePublicList;
}

function addressToSudtArgs(address: string, network: Network): string {
  // mainnet config
  let args = '0x';
  switch (network) {
    case 'Ethereum':
      args = '0x36a3a692465d2fd3e855078280cba526d90c8b5c98c5da1c1f4430e1086ca602';
      break;
    case 'BSC':
      args = '0x07bfdc1b96a5b5d3d91b7406d5583f3921e58ce6ba54b6dfd299bd6c7031cbff';
      break;
    default:
      throw new Error(`unknown network: ${network}`);
  }
  const ownerCellTypeHash = utils.computeScriptHash({
    codeHash: '0x00000000000000000000000000000000000000000000000000545950455f4944',
    hashType: 'type',
    args,
  });
  const bridgeLockscript = {
    codeHash: '0x93bc7a915d3d8f8b9678bc6c7a1751738c99ce6e66bba4dfab56672f6d691789',
    hashType: 'type' as 'type' | 'data',
    args: new EthAsset(address, ownerCellTypeHash).toBridgeLockscriptArgs(),
  };
  const sudtArgs = utils.computeScriptHash(bridgeLockscript);
  return sudtArgs;
}

function computeSudtTypeHash(sudtArgs: string): string {
  const sudtTypeHash = utils.computeScriptHash({
    codeHash: '0x5e7a36a77e68eecc013dfa2fe6a23f3b6c344b04005808694ae6dd45eea4cfd5',
    hashType: 'type',
    args: sudtArgs,
  });
  return sudtTypeHash;
}

async function main() {
  const allBridgedTokensConfigPath = '../configs/all-bridged-tokens.json';
  // parse ckbL2ContractAddress from existing config
  if (fs.existsSync(allBridgedTokensConfigPath)) {
    const bridgedTokens = JSON.parse(fs.readFileSync(allBridgedTokensConfigPath, 'utf8').toString());
    bridgedTokens.map((token) => {
      CachedCkbL2ContractAddressMap.set(token.symbol, token.ckbL2ContractAddress);
    });
  }
  const ethAssets = await generateWhiteList(
    '../configs/raw-mainnet-asset-white-list.json',
    '../configs/mainnet-asset-white-list.json',
    'Ethereum',
  );
  const bscAssets = await generateWhiteList(
    '../configs/bsc-raw-mainnet-asset-white-list.json',
    '../configs/bsc-mainnet-asset-white-list.json',
    'BSC',
  );
  const allBridgedTokens = [...ethAssets, ...bscAssets];
  writeJsonToFile(allBridgedTokens, allBridgedTokensConfigPath);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`generate asset white list failed, error: ${error.stack}`);
    process.exit(1);
  });
