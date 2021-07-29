import { parseAddress } from '@ckb-lumos/helpers';
import { BigNumber } from 'bignumber.js';
import { Reader } from 'ckb-js-toolkit';
import { EthAsset } from '../../ckb/model/asset';
import { ForceBridgeCore } from '../../core';
import { logger } from '../../utils/logger';

export function checkLock(amount: string, token: string, recipient: string, sudtExtraData: string): string {
  const asset = new EthAsset(token);
  if (!asset.inWhiteList()) {
    return `EthAsset ${token} not in while list`;
  }
  const assetInfo = ForceBridgeCore.config.eth.assetWhiteList.find((asset) => asset.address === token);
  if (!assetInfo) return 'invalid asset';
  const minimalAmount = asset.getMinimalAmount();
  if (BigInt(amount) < BigInt(minimalAmount)) {
    const humanizeMinimalAmount = new BigNumber(minimalAmount).times(10 ** -assetInfo.decimal).toString();
    return `minimal bridge amount is ${humanizeMinimalAmount} ${assetInfo.symbol}`;
  }
  // check sudtSize
  try {
    const recipientLockscript = parseAddress(recipient);
    const recipientLockscriptLen = new Reader(recipientLockscript.args).length() + 33;
    const sudtExtraDataLen = sudtExtraData.length / 2 - 1;
    // - capacity size: 8
    // - sudt typescript size
    //    - code_hash: 32
    //    - hash_type: 1
    //    - args: 32
    // - sude amount size: 16
    const sudtSizeLimit = ForceBridgeCore.config.ckb.sudtSize;
    const actualSudtSize = recipientLockscriptLen + sudtExtraDataLen + 89;
    logger.debug(
      `check sudtSize: ${JSON.stringify({
        sudtSizeLimit,
        actualSudtSize,
        recipientLockscriptLen,
        sudtExtraDataLen,
      })}`,
    );
    if (actualSudtSize > sudtSizeLimit) {
      return `sudt size exceeds limit: ${JSON.stringify({ sudtSizeLimit, actualSudtSize })}`;
    }
  } catch (e) {
    logger.debug('check sudt size error', e);
    return `invalid ckb recipient address: ${recipient}`;
  }
  return '';
}
