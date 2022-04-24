import { EthAsset } from '@force-bridge/x/dist/ckb/model/asset';
import { getOwnerTypeHash } from '@force-bridge/x/dist/ckb/tx-helper/multisig/multisig_helper';
import { ForceBridgeCore } from '@force-bridge/x/dist/core';
import { LockRecord, UnlockRecord } from '@force-bridge/x/dist/db/model';
import { Amount } from '@lay2/pw-core';
import { TransactionSummary } from '../../types/apiv1';
import SummaryResponse from './summary';

class Nervos extends SummaryResponse {
  getTokenShadowIdent(XChainToken: string): string | undefined {
    return ForceBridgeCore.ckb.utils.scriptToHash(<CKBComponents.Script>{
      codeHash: ForceBridgeCore.config.ckb.deps.bridgeLock.script.codeHash,
      hashType: ForceBridgeCore.config.ckb.deps.bridgeLock.script.hashType,
      args: new EthAsset(XChainToken, getOwnerTypeHash()).toBridgeLockscriptArgs(),
    });
  }

  responseLock(record: LockRecord): TransactionSummary {
    const confirmStatus = record.lock_confirm_status === 'confirmed' ? 'confirmed' : record.lock_confirm_number;
    const bridgeFee = ForceBridgeCore.config.eth.lockNervosAssetFee;
    const mintAmount =
      record.mint_amount === null
        ? new Amount(record.lock_amount, 0).sub(new Amount(bridgeFee, 0)).toString(0)
        : record.mint_amount;
    if (!record.mint_asset) {
      const asset = ForceBridgeCore.config.eth.nervosAssetWhiteList.find((a) => a.typescriptHash === record.asset);
      if (asset) {
        record.mint_asset = asset.xchainTokenAddress;
      }
    }
    const summary: TransactionSummary = {
      txSummary: {
        fromAsset: {
          network: 'Nervos',
          ident: record.asset,
          amount: record.lock_amount,
        },
        toAsset: {
          network: 'Ethereum',
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          ident: record.mint_asset!,
          amount: mintAmount,
        },
        sender: record.sender,
        recipient: record.recipient,
        fromTransaction: {
          txId: record.lock_hash,
          timestamp: record.lock_time,
          confirmStatus: confirmStatus,
        },
      },
    };
    if (record.mint_hash) {
      summary.txSummary.toTransaction = { txId: record.mint_hash, timestamp: record.mint_time };
    }

    return summary;
  }

  responseUnlock(record: UnlockRecord): TransactionSummary {
    const confirmStatus = record.burn_confirm_status === 'confirmed' ? 'confirmed' : record.burn_confirm_number;
    const bridgeFee = ForceBridgeCore.config.eth.burnNervosAssetFee;
    const unlockAmount =
      record.unlock_amount === null
        ? new Amount(record.burn_amount, 0).sub(new Amount(bridgeFee, 0)).toString(0)
        : record.unlock_amount;
    if (!record.unlock_asset) {
      const asset = ForceBridgeCore.config.eth.nervosAssetWhiteList.find((a) => a.xchainTokenAddress === record.asset);
      if (asset) {
        record.unlock_asset = asset.typescriptHash;
      }
    }
    const summary: TransactionSummary = {
      txSummary: {
        fromAsset: {
          network: 'Ethereum',
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          ident: record.asset,
          amount: record.burn_amount,
        },
        toAsset: {
          network: 'Nervos',
          ident: record.unlock_asset!,
          amount: unlockAmount,
        },
        sender: record.sender,
        recipient: record.recipient,
        fromTransaction: {
          txId: record.burn_hash,
          timestamp: record.burn_time,
          confirmStatus: confirmStatus,
        },
      },
    };
    if (record.unlock_hash) {
      summary.txSummary.toTransaction = { txId: record.unlock_hash, timestamp: record.unlock_time };
    }

    return summary;
  }
}

export default Nervos;
