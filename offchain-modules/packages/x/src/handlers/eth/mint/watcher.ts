import { forceBridgeRole as ForceBridgeRole } from '../../../config';
import Mint from './mint';

class Watcher extends Mint {
  protected role: ForceBridgeRole = 'watcher';
}

export default Watcher;
