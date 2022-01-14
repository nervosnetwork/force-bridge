import { forceBridgeRole as ForceBridgeRole } from '../../../config';
import Mint from './mint';

class Verifier extends Mint {
  protected role: ForceBridgeRole = 'verifier';
}

export default Verifier;
