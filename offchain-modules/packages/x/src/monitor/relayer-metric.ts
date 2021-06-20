import * as Prometheus from 'prom-client';
import { forceBridgeRole } from '../config';
import { logger } from '../utils/logger';

export type chainType = 'ckb' | 'eth';
export type txType = 'ckb_mint' | 'ckb_burn' | 'eth_lock' | 'eth_unlock';
export type txStatus = 'success' | 'failed';

export class RelayerMetric {
  private relayBlockHeightNum: Prometheus.Gauge<any>;
  private relayBridgeTxNum: Prometheus.Counter<any>;
  private relayBridgeTokenAmountNum: Prometheus.Gauge<any>;
  private gateway: Prometheus.Pushgateway;
  private openPushMetric: boolean;

  constructor(role: forceBridgeRole, pushGatewayURL: string) {
    const register = new Prometheus.Registry();

    this.relayBlockHeightNum = new Prometheus.Gauge({
      name: `${role}_block_height_number`,
      help: `block height synced by different ${role}.`,
      labelNames: ['role', 'height_type'],
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
    register.registerMetric(this.relayBlockHeightNum);
    register.registerMetric(this.relayBridgeTxNum);
    register.registerMetric(this.relayBridgeTokenAmountNum);

    if (pushGatewayURL != '' && pushGatewayURL.startsWith('http')) {
      this.gateway = new Prometheus.Pushgateway(pushGatewayURL, [], register);
      this.openPushMetric = true;
    }
  }

  setBlockHeightMetrics(role: forceBridgeRole, chain_type: chainType, sync_height: number): void {
    this.relayBlockHeightNum.labels({ role: role, height_type: `${chain_type}_synced_height` }).set(sync_height);
    this.handlerPushMetric('relay_bridgetx');
  }

  addBridgeTxMetrics(tx_type: txType, tx_status: txStatus): void {
    this.relayBridgeTxNum.labels({ tx_type: tx_type, status: tx_status }).inc(1);
    this.handlerPushMetric('relay_bridgetx');
  }

  addBridgeTokenMetrics(tx_type: txType, token: string, amount: number): void {
    this.relayBridgeTokenAmountNum.labels({ tx_type: tx_type, token: token }).inc(amount);
    this.handlerPushMetric('relay_bridgetx');
  }

  // onBridgeEventMetrics(tx_type: txType,tx_status: txStatus, token: string, amount :number){
  //   this.relayBridgeTxNum.labels({tx_type: tx_type, status: tx_status}).inc(1);
  //   if (tx_status == 'success') {
  //     this.relayBridgeTokenAmountNum.labels({tx_type: tx_type,token: token}).inc(amount);
  //   }
  //   this.handlerPushMetric('relay_bridgetx');
  // }

  handlerPushMetric(jobName: string): void {
    if (this.openPushMetric) {
      this.gateway.push({ jobName: jobName }, (err, resp, body) => {
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
