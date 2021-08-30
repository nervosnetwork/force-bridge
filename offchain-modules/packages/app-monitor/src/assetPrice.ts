import { WhiteListEthAsset } from '@force-bridge/x/dist/config';
import { logger } from '@force-bridge/x/dist/utils/logger';
import axios from 'axios';
import { BigNumber } from 'bignumber.js';

export interface priceAlert {
  symbol: string;
  configPrice: string;
  currentPrice: string;
  priceChange: number;
}

const BINANCE_EXCHANGE_API = 'https://www.binance.com/api/v3/avgPrice';

const BRIDGE_IN_FEE = 3;

const downLimit = 0.5;
const upLimit = 2;

async function getAssetAVGPrice(token: string): Promise<number> {
  try {
    const res = await axios.get(`${BINANCE_EXCHANGE_API}?symbol=${token}USDT`);
    return res.data.price;
  } catch (err) {
    logger.error('failed to get price of ', token, ' error : ', err.response.data);
    return -1;
  }
}

export async function assetListPriceChange(assetWhiteList: WhiteListEthAsset[]): Promise<priceAlert[]> {
  const result: priceAlert[] = [];
  for (const asset of assetWhiteList) {
    if (asset.symbol === 'USDT') {
      continue;
    }
    const previousPrice = new BigNumber(BRIDGE_IN_FEE)
      .multipliedBy(new BigNumber(Math.pow(10, asset.decimal)))
      .div(new BigNumber(asset.bridgeFee.in))
      .toNumber();
    const currentPrice = await getAssetAVGPrice(asset.symbol);
    if (currentPrice == -1) {
      continue;
    }
    const ticker = currentPrice / previousPrice;
    logger.info(`${asset.symbol} ticker is ${ticker}, current price is ${currentPrice}`);
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
