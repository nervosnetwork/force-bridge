import * as Prometheus from 'prom-client';
import { forceBridgeRole } from '../config';
import { BridgeMetricSingleton } from './bridge-metric';

export type status = 'success' | 'failed';
export type chainType = 'ckb' | 'eth';

export class SigserverMetric {
  //eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sigServerRequestDurationms: Prometheus.Histogram<any>;
  constructor(role: forceBridgeRole) {
    this.sigServerRequestDurationms = new Prometheus.Histogram({
      name: `${role}_sig_server_request_duration_ms`,
      help: 'Duration of sig server requests in ms',
      labelNames: ['signer', 'method', 'status'],
      buckets: [2, 10, 50, 250, 500, 1000, 2500, 5000],
    });

    BridgeMetricSingleton.getInstance(role).getRegister().registerMetric(this.sigServerRequestDurationms);
  }

  setSigServerRequestMetric(signer: string, method: string, status: status, time: number): void {
    this.sigServerRequestDurationms.labels(signer, method, status).observe(time);
  }
}
