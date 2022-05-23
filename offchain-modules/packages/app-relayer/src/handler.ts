import { nonNullable } from '@force-bridge/x';
import { ForceBridgeCore } from '@force-bridge/x/dist/core';

interface SwitchGasPriceGweiAutoPayload {
  gasPriceGweiAuto?: boolean;
  key?: string;
}

interface SwitchGasPriceGweiAutoResponse {
  gasPriceGweiAuto: boolean;
  message: string;
}

export class ForceBridgeCollectorHandler {
  async switchGasPriceGweiAuto(payload: SwitchGasPriceGweiAutoPayload): Promise<SwitchGasPriceGweiAutoResponse> {
    if (payload.key !== nonNullable(ForceBridgeCore.config.collector).gasPriceGweiAutoSwitchKey) {
      throw new Error('wrong key');
    }
    if (typeof payload.gasPriceGweiAuto !== 'boolean') {
      throw new Error('gasPriceGweiAuto should be true or false');
    }
    nonNullable(ForceBridgeCore.config.collector).gasPriceGweiAuto = payload.gasPriceGweiAuto;
    return {
      gasPriceGweiAuto: payload.gasPriceGweiAuto,
      message: `switch gasPriceGweiAuto to ${payload.gasPriceGweiAuto}`,
    };
  }
}
