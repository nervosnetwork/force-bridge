import { WhiteListEthAsset } from '@force-bridge/x/dist/config';
import { writeJsonToFile } from '@force-bridge/x/dist/utils';
import axios from 'axios';
import { BigNumber } from 'bignumber.js';

export interface Token {
  symbol: string;
  icon: string;
  ethContractAddress: string;
  ethContractDecimal: number;
  minAmount: number;
}

export interface priceAlert {
  symbol: string;
  configPrice: string;
  currentPrice: string;
  priceChange: number;
}

const BINANCE_EXCHANGE_API = 'https://www.binance.com/api/v3/avgPrice';
const BINANCE_BRIDGE_TOKENS = 'https://api.binance.org/bridge/api/v2/tokens';

const BRIDGE_IN_FEE = 3;
const BRIDGE_OUT_FEE = 15;
const MinValue = 20;

const downLimit = 0.5;
const upLimit = 2;

async function getAssetAVGPrice(token: string): Promise<number> {
  try {
    const res = await axios.get(`${BINANCE_EXCHANGE_API}?symbol=${token}USDT`);
    return res.data.price;
  } catch (err) {
    console.error('failed to get price of ', token, ' error : ', err.response.data);
    return -1;
  }
}

export async function assetListPriceChange(assetWhiteList: WhiteListEthAsset[]): Promise<priceAlert[]> {
  const result: priceAlert[] = [];
  for (const asset of assetWhiteList) {
    const previousPrice = new BigNumber(BRIDGE_IN_FEE)
      .multipliedBy(new BigNumber(Math.pow(10, asset.decimal)))
      .div(new BigNumber(asset.bridgeFee.in))
      .toNumber();
    const currentPrice = await getAssetAVGPrice(asset.symbol);
    const ticker = currentPrice / previousPrice;
    if (ticker > upLimit || ticker < downLimit) {
      result.push({
        symbol: asset.symbol,
        configPrice: previousPrice.toString(),
        currentPrice: currentPrice.toString(),
        priceChange: ticker - 1,
      });
    }
  }
  return result;
}
//  eslint-disable-next-line @typescript-eslint/no-unused-vars
async function getTokens(path: string): Promise<void> {
  try {
    const response = await axios.get(`${BINANCE_BRIDGE_TOKENS}`);
    if (response.data && response.data.data) {
      const assetWhiteList: WhiteListEthAsset[] = [];
      const tokens: Token[] = response.data.data.tokens;
      for (const token of tokens) {
        let price = 1;
        if (token.symbol != 'USDT') {
          price = await getAssetAVGPrice(token.symbol);
          if (price < 0) {
            continue;
          }
        }
        if (token.ethContractAddress === '') {
          console.log(`${token.symbol} which is not erc20 token`);
          if (token.symbol == 'ETH') {
            token.ethContractAddress = '0x0000000000000000000000000000000000000000';
          } else {
            continue;
          }
        }
        const baseAmount = new BigNumber(Math.pow(10, token.ethContractDecimal)).div(new BigNumber(price));
        const minimalBridgeAmount = baseAmount.multipliedBy(new BigNumber(MinValue)).toFixed(0);
        const inAmount = baseAmount.multipliedBy(new BigNumber(BRIDGE_IN_FEE)).toFixed(0);
        const outAmount = baseAmount.multipliedBy(new BigNumber(BRIDGE_OUT_FEE)).toFixed(0);

        const assetInfo: WhiteListEthAsset = {
          address: token.ethContractAddress,
          name: token.symbol,
          symbol: token.symbol,
          logoURI: token.icon,
          decimal: token.ethContractDecimal,
          minimalBridgeAmount: getClosestNumber(minimalBridgeAmount),
          bridgeFee: { in: getClosestNumber(inAmount), out: getClosestNumber(outAmount) },
        };
        assetWhiteList.push(assetInfo);
      }
      writeJsonToFile(assetWhiteList, path);
    }
  } catch (err) {
    console.log(`failed to get erc20 tokens`, err);
    throw err;
  }
}

function getClosestNumber(sourceNumber: string): string {
  const decimalPlaces = 2;
  let result: string = sourceNumber.slice(0, decimalPlaces);
  for (let i = 0; i < sourceNumber.length - decimalPlaces; i++) {
    result = result.concat('0');
  }
  return result;
}
