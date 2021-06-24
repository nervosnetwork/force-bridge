import * as Prometheus from 'prom-client';
import { forceBridgeRole } from '../config';
import { BridgeMetricSingleton } from './bridge-metric';

export type responseStatus = 'success' | 'failed';

export class RpcMetric {
  public rpcRequestDurationms: Prometheus.Histogram<any>;
  private rpcRequestNum: Prometheus.Counter<any>;

  constructor(role: forceBridgeRole) {
    this.rpcRequestDurationms = new Prometheus.Histogram({
      name: `${role}_rpc_request_duration_ms`,
      help: 'Duration of rpc server requests in ms',
      labelNames: ['method', 'status'],
      buckets: [2, 10, 50, 250, 500, 1000, 2500, 5000], // buckets for response time from 2ms to 5s
    });
    this.rpcRequestNum = new Prometheus.Counter({
      name: `${role}_rpc_request_total`,
      help: 'amount of rpc request',
      labelNames: ['method', 'status'],
    });
    BridgeMetricSingleton.getInstance(role).getRegister().registerMetric(this.rpcRequestDurationms);
    BridgeMetricSingleton.getInstance(role).getRegister().registerMetric(this.rpcRequestNum);
  }

  setRpcRequestMetric(method: string, status: responseStatus, time: number): void {
    this.rpcRequestDurationms.labels(method, status).observe(time);
    this.rpcRequestNum.labels(method, status).inc(1);
  }
}
