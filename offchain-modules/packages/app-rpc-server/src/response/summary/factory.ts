import { BlockChainNetWork } from '../../types/apiv1';
import Ethereum from './ethereum';
import Nervos from './nervos';
import SummaryResponse from './summary';

export abstract class Factory {
  static fromNetwrok(network: BlockChainNetWork): SummaryResponse {
    switch (network) {
      case 'Ethereum':
        return new Ethereum();
      case 'Nervos':
        return new Nervos();
      default:
        throw new Error(`chain type is ${network} which not support yet.`);
    }
  }
}
