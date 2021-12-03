import axios from 'axios';

const BINANCE_EXCHANGE_API = 'https://www.binance.com/api/v3/ticker/24hr';

export async function getAssetAVGPrice(token: string): Promise<string> {
  if (token === 'USDT') {
    return '1';
  }
  try {
    const res = await axios.get(`${BINANCE_EXCHANGE_API}?symbol=${token}USDT`);
    return res.data.weightedAvgPrice;
  } catch (err) {
    throw new Error(`failed to get price of ${token}, error: ${err.response.data}`);
  }
}

interface CachedPrice {
  price: string;
  date: Date;
}

const age = 1000 * 60 * 60 * 6; // 6 hour
const cache: { [key: string]: CachedPrice } = {};

export async function getCachedAssetAVGPrice(token: string): Promise<string> {
  const cachedPrice = cache[token];
  if (cachedPrice && cachedPrice.date.getTime() + age > new Date().getTime()) {
    return cachedPrice.price;
  }
  const price = await getAssetAVGPrice(token);
  cache[token] = {
    price,
    date: new Date(),
  };
  return price;
}

export function getClosestNumber(sourceNumber: string): string {
  const decimalPlaces = 3;
  let result: string = sourceNumber.slice(0, decimalPlaces);
  for (let i = 0; i < sourceNumber.length - decimalPlaces; i++) {
    result = result.concat('0');
  }
  return result;
}
