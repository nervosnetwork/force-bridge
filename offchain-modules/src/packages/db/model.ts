import { EthUnlock } from '@force-bridge/db/entity/EthUnlock';
import { CkbBurn } from '@force-bridge/db/entity/CkbBurn';
import { CkbMint } from '@force-bridge/db/entity/CkbMint';
import { BtcUnlock } from '@force-bridge/db/entity/BtcUnlock';
import { BtcLock } from '@force-bridge/db/entity/BtcLock';
import { EthLock } from '@force-bridge/db/entity/EthLock';
import { TronLock } from '@force-bridge/db/entity/TronLock';
import { TronUnlock } from '@force-bridge/db/entity/TronUnlock';

export { EthUnlock, EthLock, BtcLock, BtcUnlock, CkbMint, CkbBurn, TronLock, TronUnlock };

export type XchainUnlock = EthUnlock | BtcUnlock;
export async function transformBurnEvent(burn: CkbBurn): Promise<XchainUnlock> {
  throw new Error('Method not implemented.');
}

export type XchainLock = EthLock | BtcLock;
export async function transformMintEvent(burn: XchainLock): Promise<CkbMint> {
  throw new Error('Method not implemented.');
}
