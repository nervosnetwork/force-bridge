import * as Prometheus from 'prom-client';
import { logger } from '../utils/logger';

export type status = 'success' | 'failed';
export type chainType = 'ckb' | 'eth';

export class SigserverMetric {
  private sigServerRequestDurationms: Prometheus.Histogram<any>;
  private sigServerSignatureNum: Prometheus.Counter<any>;
  private gateway: Prometheus.Pushgateway;
  private openPushMetric: boolean;
  constructor(pushGatewayURL: string) {
    const Registry = Prometheus.Registry;
    const register = new Registry();
    this.sigServerRequestDurationms = new Prometheus.Histogram({
      name: 'sig_server_request_duration_ms',
      help: 'Duration of sig server requests in ms',
      labelNames: ['signer', 'method', 'status'],
      buckets: [0.1, 5, 15, 50, 100],
    });
    this.sigServerSignatureNum = new Prometheus.Counter({
      name: 'sig_server_sign_total',
      help: 'amount of signature',
      labelNames: ['method', 'status'],
    });
    register.registerMetric(this.sigServerRequestDurationms);
    if (pushGatewayURL != '' && pushGatewayURL.startsWith('http')) {
      this.gateway = new Prometheus.Pushgateway(pushGatewayURL, [], register);
      this.openPushMetric = true;
    }
  }

  setSigServerRequestMetric(signer: string, method: string, status: status, time: number): void {
    this.sigServerRequestDurationms.labels(signer, method, status).observe(time);
    this.sigServerSignatureNum.labels(signer, method, status).inc(1);
    this.handlerPushMetric('sig_server_request');
  }

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
