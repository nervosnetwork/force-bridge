import { WhiteListEthAsset } from '@force-bridge/x/dist/config';
import { writeJsonToFile } from '@force-bridge/x/dist/utils';
import axios from 'axios';
import { BigNumber } from 'bignumber.js';
import * as cheerio from 'cheerio';
export interface Token {
  symbol: string;
  icon: string;
  ethContractAddress: string;
  ethContractDecimal: number;
  minAmount: number;
}

const BRIDGE_IN_FEE = 3;
const BRIDGE_OUT_FEE = 15;
const MinValue = 20;

const BINANCE_EXCHANGE_API = 'https://www.binance.com/api/v3/avgPrice';
const BINANCE_BRIDGE_TOKENS = 'https://api.binance.org/bridge/api/v2/tokens';

const LOGO_WEB = `https://cryptologos.cc/logos/`;

async function getAssetAVGPrice(token: string): Promise<number> {
  try {
    const res = await axios.get(`${BINANCE_EXCHANGE_API}?symbol=${token}USDT`);
    return res.data.price;
  } catch (err) {
    console.error('failed to get price of ', token, ' error : ', err.response.data);
    return -1;
  }
}

async function getLogoURIs(): Promise<Map<string, string>> {
  const requestUrl = LOGO_WEB;
  const logoURIs: Map<string, string> = new Map<string, string>();
  const response = await axios.get(requestUrl);
  const $ = cheerio.load(response.data);
  const postList = $('a');
  postList.each((_, value) => {
    const link: string = $(value).attr('href')!;
    let token = link.match(/-(\S*)-/)![1];
    const index = token.lastIndexOf('-');
    if (index != -1) {
      token = token.substring(index + 1, token.length);
    }
    logoURIs.set(token, link);
  });
  return logoURIs;
}

//  eslint-disable-next-line @typescript-eslint/no-unused-vars
async function getTokens(path: string): Promise<void> {
  try {
    const response = await axios.get(`${BINANCE_BRIDGE_TOKENS}`);
    if (response.data && response.data.data) {
      const assetWhiteList: WhiteListEthAsset[] = [];
      const tokens: Token[] = response.data.data.tokens;
      const logos = await getLogoURIs();
      let price = 1;
      for (const token of tokens) {
        if (token.symbol != 'USDT') {
          price = await getAssetAVGPrice(token.symbol);
          if (price < 0) {
            continue;
          }
        }
        let logo = token.icon;
        if (logos.has(token.symbol.toLowerCase())) {
          logo = logos.get(token.symbol.toLowerCase())!;
        }
        if (token.ethContractAddress === '') {
          if (token.symbol == 'ETH') {
            token.ethContractAddress = '0x0000000000000000000000000000000000000000';
          } else {
            console.log(`${token.symbol} is not erc20 token`);
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
          logoURI: logo,
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
