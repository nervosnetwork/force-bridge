import * as Prometheus from 'prom-client';
import { forceBridgeRole } from '../config';
import { ServerSingleton } from '../server/serverSingleton';

export type chainType = 'ckb' | 'eth';
export type txType = 'ckb_mint' | 'ckb_burn' | 'eth_lock' | 'eth_unlock';
export type txStatus = 'success' | 'failed';
export type txTokenInfo = {
  token: string;
  amount: number;
};

export class BridgeMetricSingleton {
  private static instance: BridgeMetricSingleton;

  private readonly relayBlockHeightNum: Prometheus.Gauge<string>;
  private readonly relayBridgeTxNum: Prometheus.Counter<string>;
  private readonly relayBridgeTokenAmountNum: Prometheus.Gauge<string>;
  private readonly relayForkHeightNum: Prometheus.Gauge<string>;

  private readonly relayErrorLogNum: Prometheus.Gauge<string>;

  private readonly register: Prometheus.Registry;

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
    this.relayForkHeightNum = new Prometheus.Gauge({
      name: `${role}_fork_height_num`,
      help: `height of fork block`,
      labelNames: ['chain'],
    });
    this.relayErrorLogNum = new Prometheus.Gauge({
      name: `${role}_error_log_num`,
      help: `amount of error log`,
    });
    this.register.registerMetric(this.relayBlockHeightNum);
    this.register.registerMetric(this.relayBridgeTxNum);
    this.register.registerMetric(this.relayBridgeTokenAmountNum);
    this.register.registerMetric(this.relayForkHeightNum);
    this.register.registerMetric(this.relayErrorLogNum);
  }

  init(openMetrics: boolean): void {
    if (openMetrics) {
      ServerSingleton.getInstance()
        .getServer()
        .get('/metrics', async (req, res) => {
          try {
            res.set('Content-Type', this.register.contentType);
            res.end(await this.register.metrics());
          } catch (ex) {
            res.status(500).end(ex);
          }
        });

      ServerSingleton.getInstance()
        .getServer()
        .get('/metrics/counter', async (req, res) => {
          try {
            res.set('Content-Type', this.register.contentType);
            res.end(await this.register.getSingleMetricAsString('test_counter'));
          } catch (ex) {
            res.status(500).end(ex);
          }
        });
    }
  }

  public getRegister(): Prometheus.Registry {
    return this.register;
  }

  public setBlockHeightMetrics(chain_type: chainType, sync_height: number, actual_height: number): void {
    this.relayBlockHeightNum.labels({ height_type: `${chain_type}_synced_height` }).set(sync_height);
    this.relayBlockHeightNum.labels({ height_type: `${chain_type}_actual_height` }).set(actual_height);
  }

  public setForkEventHeightMetrics(chain_type: chainType, height: number): void {
    this.relayForkHeightNum.labels({ chain: chain_type }).set(height);
  }

  public addErrorLogMetrics(): void {
    this.relayErrorLogNum.inc(1);
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
