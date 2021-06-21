import * as Prometheus from 'prom-client';
import { Config, forceBridgeRole } from '../config';
import { logger } from '../utils/logger';

export type chainType = 'ckb' | 'eth';
export type txType = 'ckb_mint' | 'ckb_burn' | 'eth_lock' | 'eth_unlock';
export type txStatus = 'success' | 'failed';
export type txTokenInfo = {
  token: string;
  amount: number;
};

export class RelayerMetric {
  private static _relayBlockHeightNum: Prometheus.Gauge<any>;
  private static _relayBridgeTxNum: Prometheus.Counter<any>;
  private static _relayBridgeTokenAmountNum: Prometheus.Gauge<any>;

  private static _gateway: Prometheus.Pushgateway;
  private static _openPushMetric: boolean;

  constructor(role: forceBridgeRole) {
    RelayerMetric._relayBlockHeightNum = new Prometheus.Gauge({
      name: `${role}_block_height_number`,
      help: `block height synced by different ${role}.`,
      labelNames: ['role', 'height_type'],
    });
    RelayerMetric._relayBridgeTxNum = new Prometheus.Counter({
      name: `${role}_bridgetx_total`,
      help: `tx amount of lock,mint,burn,unlock`,
      labelNames: ['tx_type', 'status'],
    });
    RelayerMetric._relayBridgeTokenAmountNum = new Prometheus.Gauge({
      name: `${role}_bridge_token_amount`,
      help: `token amount of lock,mint,burn,unlock`,
      labelNames: ['tx_type', 'token'],
    });
  }

  init(pushGatewayURL: string): void {
    const register = new Prometheus.Registry();

    register.registerMetric(RelayerMetric._relayBlockHeightNum);
    register.registerMetric(RelayerMetric._relayBridgeTxNum);
    register.registerMetric(RelayerMetric._relayBridgeTokenAmountNum);

    if (pushGatewayURL != '' && pushGatewayURL.startsWith('http')) {
      RelayerMetric._gateway = new Prometheus.Pushgateway(pushGatewayURL, [], register);
      RelayerMetric._openPushMetric = true;
    }
  }

  static setBlockHeightMetrics(
    role: forceBridgeRole,
    chain_type: chainType,
    sync_height: number,
    actual_height: number,
  ): void {
    RelayerMetric._relayBlockHeightNum
      .labels({ role: role, height_type: `${chain_type}_synced_height` })
      .set(sync_height);
    RelayerMetric._relayBlockHeightNum
      .labels({ role: role, height_type: `${chain_type}_actual_height` })
      .set(actual_height);
    RelayerMetric.handlerPushMetric('relay_bridgetx');
  }

  static addBridgeTxMetrics(tx_type: txType, tx_status: txStatus): void {
    RelayerMetric._relayBridgeTxNum.labels({ tx_type: tx_type, status: tx_status }).inc(1);
    RelayerMetric.handlerPushMetric('relay_bridgetx');
  }

  static addBridgeTokenMetrics(tx_type: txType, tokens: txTokenInfo[]): void {
    tokens.map((tokenInfo) => {
      RelayerMetric._relayBridgeTokenAmountNum
        .labels({ tx_type: tx_type, token: tokenInfo.token })
        .inc(Number(tokenInfo.amount));
    });
    RelayerMetric.handlerPushMetric('relay_bridgetx');
  }

  static handlerPushMetric(jobName: string): void {
    if (RelayerMetric._openPushMetric) {
      RelayerMetric._gateway.push({ jobName: jobName }, (err, resp, body) => {
        if (err != null) {
          logger.warn(
            `Prometheus Monitor PushGateWay ${jobName} Error: failed to push ${jobName} metrics. error is ${err}, callback body is ${body}, response is ${JSON.stringify(
              resp,
              null,
              2,
            )}`,
          );
        }
      });
    }
  }
}
