import * as Prometheus from 'prom-client';
import { forceBridgeRole } from '../config';
import { BridgeMetricSingleton } from './bridge-metric';

export type status = 'success' | 'failed';
export type chainType = 'ckb' | 'eth';

export class SigserverMetric {
  private sigServerRequestDurationms: Prometheus.Histogram<any>;
  private sigServerSignatureNum: Prometheus.Counter<any>;
  constructor(role: forceBridgeRole) {
    this.sigServerRequestDurationms = new Prometheus.Histogram({
      name: `${role}_sig_server_request_duration_ms`,
      help: 'Duration of sig server requests in ms',
      labelNames: ['signer', 'method', 'status'],
      buckets: [2, 10, 50, 250, 500, 1000, 2500, 5000],
    });
    this.sigServerSignatureNum = new Prometheus.Counter({
      name: `${role}_sig_server_sign_total`,
      help: 'amount of signature',
      labelNames: ['method', 'status'],
    });
    BridgeMetricSingleton.getInstance(role).getRegister().registerMetric(this.sigServerRequestDurationms);
    BridgeMetricSingleton.getInstance(role).getRegister().registerMetric(this.sigServerSignatureNum);
  }

  setSigServerRequestMetric(signer: string, method: string, status: status, time: number): void {
    this.sigServerRequestDurationms.labels(signer, method, status).observe(time);
    this.sigServerSignatureNum.labels(signer, method, status).inc(1);
  }
}
