import axios from 'axios';

const BINANCE_EXCHANGE_API = 'https://www.binance.com/api/v3/ticker/24hr';

export async function getAssetAVGPrice(token: string): Promise<number> {
  try {
    const res = await axios.get(`${BINANCE_EXCHANGE_API}?symbol=${token}USDT`);
    return res.data.weightedAvgPrice;
  } catch (err) {
    console.error('failed to get price of ', token, ' error : ', err.response.data);
    return -1;
  }
}

export function getClosestNumber(sourceNumber: string): string {
  const decimalPlaces = 3;
  let result: string = sourceNumber.slice(0, decimalPlaces);
  for (let i = 0; i < sourceNumber.length - decimalPlaces; i++) {
    result = result.concat('0');
  }
  return result;
}
