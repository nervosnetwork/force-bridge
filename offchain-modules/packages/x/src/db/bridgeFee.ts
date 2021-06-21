import { Amount } from '@lay2/pw-core';
import { Connection } from 'typeorm';
import { ChainType } from '../ckb/model/asset';
import { WithdrawedBridgeFee } from './entity/WithdrawedBridgeFee';
import { IWithdrawedBridgeFee } from './model';

export class BridgeFeeDB {
  constructor(private conn: Connection) {}

  async createWithdrawedBridgeFee(records: IWithdrawedBridgeFee[]): Promise<void> {
    const repository = this.conn.getRepository(WithdrawedBridgeFee);
    const dbRecords = records.map((r) => repository.create(r));
    await repository.save(dbRecords);
  }

  async getEthTotalGeneratedBridgeInFee(asset: string): Promise<string> {
    return this.conn.manager.query(
      `select SUM(cast(bridge_fee as DECIMAL(32,0))) from eth_lock where token='${asset}'`,
    );
  }

  async getEthTotalGeneratedBridgeOutFee(asset: string): Promise<string> {
    return this.conn.manager.query(
      `select SUM(cast(bridge_fee as DECIMAL(32,0))) from ckb_burn where asset='${asset}'`,
    );
  }

  async getEthTotalGeneratedBridgeFee(asset: string): Promise<string> {
    const bridgeInFee = await this.getEthTotalGeneratedBridgeInFee(asset);
    const bridgeOutFee = await this.getEthTotalGeneratedBridgeOutFee(asset);
    return new Amount(bridgeInFee, 0).add(new Amount(bridgeOutFee, 0)).toString(0);
  }

  async getEthTotalWithdrawedBridgeFee(asset: string): Promise<string> {
    const chain = ChainType.ETH;
    return this.conn.manager.query(
      `select SUM(cast(amount as DECIMAL(32,0))) from withdrawed_bridge_fee where asset='${asset}' and chain=${chain}`,
    );
  }
}
