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

  private _relayBlockHeightNum: Prometheus.Gauge<any>;
  private _relayBridgeTxNum: Prometheus.Counter<any>;
  private _relayBridgeTokenAmountNum: Prometheus.Gauge<any>;
  private _register: Prometheus.Registry;

  constructor(role: forceBridgeRole) {
    this._register = new Prometheus.Registry();
    this._relayBlockHeightNum = new Prometheus.Gauge({
      name: `${role}_block_height_number`,
      help: `block height synced by different ${role}.`,
      labelNames: ['height_type'],
    });
    this._relayBridgeTxNum = new Prometheus.Counter({
      name: `${role}_bridgetx_total`,
      help: `tx amount of lock,mint,burn,unlock`,
      labelNames: ['tx_type', 'status'],
    });
    this._relayBridgeTokenAmountNum = new Prometheus.Gauge({
      name: `${role}_bridge_token_amount`,
      help: `token amount of lock,mint,burn,unlock`,
      labelNames: ['tx_type', 'token'],
    });
    this._register.registerMetric(this._relayBlockHeightNum);
    this._register.registerMetric(this._relayBridgeTxNum);
    this._register.registerMetric(this._relayBridgeTokenAmountNum);
  }

  init(metricsPort: number): void {
    if (metricsPort != -1) {
      const server = express();
      server.get('/metrics', async (req, res) => {
        try {
          res.set('Content-Type', this._register.contentType);
          res.end(await this._register.metrics());
        } catch (ex) {
          res.status(500).end(ex);
        }
      });

      server.get('/metrics/counter', async (req, res) => {
        try {
          res.set('Content-Type', this._register.contentType);
          res.end(await this._register.getSingleMetricAsString('test_counter'));
        } catch (ex) {
          res.status(500).end(ex);
        }
      });

      logger.info(`Metric Server:  listening to ${metricsPort}, metrics exposed on /metrics endpoint`);
      server.listen(metricsPort);
    }
  }

  public getRegister(): Prometheus.Registry {
    return this._register;
  }

  public setBlockHeightMetrics(chain_type: chainType, sync_height: number, actual_height: number): void {
    this._relayBlockHeightNum.labels({ height_type: `${chain_type}_synced_height` }).set(sync_height);
    this._relayBlockHeightNum.labels({ height_type: `${chain_type}_actual_height` }).set(actual_height);
  }

  public addBridgeTxMetrics(tx_type: txType, tx_status: txStatus): void {
    this._relayBridgeTxNum.labels({ tx_type: tx_type, status: tx_status }).inc(1);
  }

  public addBridgeTokenMetrics(tx_type: txType, tokens: txTokenInfo[]): void {
    tokens.map((tokenInfo) => {
      this._relayBridgeTokenAmountNum
        .labels({ tx_type: tx_type, token: tokenInfo.token })
        .inc(Number(tokenInfo.amount));
    });
  }

  public static getInstance(role: forceBridgeRole): BridgeMetricSingleton {
    if (!BridgeMetricSingleton.instance) {
      BridgeMetricSingleton.instance = new BridgeMetricSingleton(role);
    }
    return BridgeMetricSingleton.instance;
  }
}
