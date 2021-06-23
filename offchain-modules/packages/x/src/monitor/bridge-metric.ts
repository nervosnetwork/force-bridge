import express from 'express';
import * as Prometheus from 'prom-client';
import { forceBridgeRole } from '../config';
import { logger } from '../utils/logger';

export type chainType = 'ckb' | 'eth';
export type txType = 'ckb_mint' | 'ckb_burn' | 'eth_lock' | 'eth_unlock';
export type txStatus = 'success' | 'failed';
export type txTokenInfo = {
  token: string;
  amount: number;
};

export class BridgeMetricSingleton {
  private static instance: BridgeMetricSingleton;

  private relayBlockHeightNum: Prometheus.Gauge<any>;
  private relayBridgeTxNum: Prometheus.Counter<any>;
  private relayBridgeTokenAmountNum: Prometheus.Gauge<any>;
  private register: Prometheus.Registry;

  constructor(role: forceBridgeRole) {
    this.register = new Prometheus.Registry();
    this.relayBlockHeightNum = new Prometheus.Gauge({
      name: `${role}_block_height_number`,
      help: `block height synced by different ${role}.`,
      labelNames: ['height_type'],
    });
    this.relayBridgeTxNum = new Prometheus.Counter({
      name: `${role}_bridgetx_total`,
      help: `tx amount of lock,mint,burn,unlock`,
      labelNames: ['tx_type', 'status'],
    });
    this.relayBridgeTokenAmountNum = new Prometheus.Gauge({
      name: `${role}_bridge_token_amount`,
      help: `token amount of lock,mint,burn,unlock`,
      labelNames: ['tx_type', 'token'],
    });
    this.register.registerMetric(this.relayBlockHeightNum);
    this.register.registerMetric(this.relayBridgeTxNum);
    this.register.registerMetric(this.relayBridgeTokenAmountNum);
  }

  init(metricsPort: number): void {
    if (metricsPort != -1) {
      const server = express();
      server.get('/metrics', async (req, res) => {
        try {
          res.set('Content-Type', this.register.contentType);
          res.end(await this.register.metrics());
        } catch (ex) {
          res.status(500).end(ex);
        }
      });

      server.get('/metrics/counter', async (req, res) => {
        try {
          res.set('Content-Type', this.register.contentType);
          res.end(await this.register.getSingleMetricAsString('test_counter'));
        } catch (ex) {
          res.status(500).end(ex);
        }
      });

      server.listen(metricsPort);
      logger.info(`Metric Server:  listening to ${metricsPort}, metrics exposed on /metrics endpoint`);
    }
  }

  public getRegister(): Prometheus.Registry {
    return this.register;
  }

  public setBlockHeightMetrics(chain_type: chainType, sync_height: number, actual_height: number): void {
    this.relayBlockHeightNum.labels({ height_type: `${chain_type}_synced_height` }).set(sync_height);
    this.relayBlockHeightNum.labels({ height_type: `${chain_type}_actual_height` }).set(actual_height);
  }

  public addBridgeTxMetrics(tx_type: txType, tx_status: txStatus): void {
    this.relayBridgeTxNum.labels({ tx_type: tx_type, status: tx_status }).inc(1);
  }

  public addBridgeTokenMetrics(tx_type: txType, tokens: txTokenInfo[]): void {
    tokens.map((tokenInfo) => {
      this.relayBridgeTokenAmountNum.labels({ tx_type: tx_type, token: tokenInfo.token }).inc(Number(tokenInfo.amount));
    });
  }

  public static getInstance(role: forceBridgeRole): BridgeMetricSingleton {
    if (!BridgeMetricSingleton.instance) {
      BridgeMetricSingleton.instance = new BridgeMetricSingleton(role);
    }
    return BridgeMetricSingleton.instance;
  }
}
