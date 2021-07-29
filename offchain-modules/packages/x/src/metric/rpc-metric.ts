import * as Prometheus from 'prom-client';
import { forceBridgeRole } from '../config';
import { BridgeMetricSingleton } from './bridge-metric';

export type responseStatus = 'success' | 'failed';

export class RpcMetric {
  //eslint-disable-next-line @typescript-eslint/no-explicit-any
  public rpcRequestDurationms: Prometheus.Histogram<any>;

  constructor(role: forceBridgeRole) {
    this.rpcRequestDurationms = new Prometheus.Histogram({
      name: `${role}_rpc_request_duration_ms`,
      help: 'Duration of rpc server requests in ms',
      labelNames: ['method', 'status'],
      buckets: [2, 10, 50, 250, 500, 1000, 2500, 5000], // buckets for response time from 2ms to 5s
    });
    BridgeMetricSingleton.getInstance(role).getRegister().registerMetric(this.rpcRequestDurationms);
  }

  setRpcRequestMetric(method: string, status: responseStatus, time: number): void {
    this.rpcRequestDurationms.labels(method, status).observe(time);
  }
}
