import * as Prometheus from "prom-client";
import {logger} from "../utils/logger";

export type heightType = 'synced_ckb_height' | 'actual_ckb_height' | 'synced_eth_height' | 'actual_eth_height';
export type txType = 'ckb_mint' | 'ckb_burn' | 'eth_lock' | 'eth_unlock';

export class RelayerMetric {
    private  relayBlockHeightNum:  Prometheus.Gauge<any>;
    private  relayBridgeTxNum:  Prometheus.Counter<any>;
    private gateway : Prometheus.Pushgateway;
    private openPushMetric : boolean;

    constructor(pushGatewayURL : string) {
        const Registry = Prometheus.Registry;
        const register = new Registry();

        this.relayBlockHeightNum =  new Prometheus.Gauge({
            name: 'relay_block_height_number',
            help: 'block height snyaced by collector. and actual height',
            labelNames: ['height_type'],
        });
        this.relayBridgeTxNum = new Prometheus.Counter({
            name: 'relay_bridgetx_total',
            help: 'amount of lock,mint,burn,unlock',
            labelNames: ['tx_type'],
        });
        register.registerMetric(this.relayBlockHeightNum);
        register.registerMetric(this.relayBridgeTxNum);

        if (pushGatewayURL != "" && pushGatewayURL.startsWith("http")) {
            this.gateway = new Prometheus.Pushgateway(pushGatewayURL, [], register);
            this.openPushMetric = true;
        }
    }

    setBlockHeightMetrics(height_type : heightType, height : number){
        this.relayBlockHeightNum.set({height_type: height_type},height);
        this.handlerPushMetric("relay_bridgetx");
    }

    addBridgeTxMetrics (tx_type : txType){
        this.relayBridgeTxNum.inc({tx_type: tx_type});
        this.handlerPushMetric("relay_bridgetx");
    }

    handlerPushMetric(jobName: string){
        if (this.openPushMetric) {
            this.gateway.push({jobName: jobName}, (err, resp, body) => {
                if (err!=null){
                    logger.warn(`Prometheus Monitor PushGateWay ${jobName} Error: failed to push ${jobName} metrics. error is ${err}, callback body is ${body}, response is ${JSON.stringify(resp,null,2)}`);
                }
            })
        }
    }
}
