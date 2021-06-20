import * as Prometheus from 'prom-client';
import { logger } from '../utils/logger';

export type responseStatus = 'success' | 'failed';

export class RpcMetric {
  public rpcRequestDurationms: Prometheus.Histogram<any>;
  private gateway: Prometheus.Pushgateway;
  private openPushMetric: boolean;
  constructor(pushGatewayURL: string) {
    const register = new Prometheus.Registry();
    this.rpcRequestDurationms = new Prometheus.Histogram({
      name: 'rpc_request_duration_ms',
      help: 'Duration of rpc server requests in ms',
      labelNames: ['method', 'status'],
      buckets: [0.1, 5, 15, 50, 100], // buckets for response time from 0.1ms to 100ms
    });
    register.registerMetric(this.rpcRequestDurationms);
    if (pushGatewayURL != '' && pushGatewayURL.startsWith('http')) {
      this.gateway = new Prometheus.Pushgateway(pushGatewayURL, [], register);
      this.openPushMetric = true;
    }
  }

  setRpcRequestDurationMetric(method: string, status: responseStatus, time: number): void {
    this.rpcRequestDurationms.labels(method, status).observe(time);
    this.handlerPushMetric('rpc_request');
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
