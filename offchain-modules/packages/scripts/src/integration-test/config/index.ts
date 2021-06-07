import { Config } from '@force-bridge/x/dist/config';
import nconf from 'nconf';

function main() {
  const configPath = process.env.CONFIG_PATH || './config.json';
  nconf.env().file({ file: configPath });
  const cfg: Config = nconf.get('forceBridge');

  updateConfig('./packages/scripts/src/integration-test/config/collector.json', cfg);
  updateConfig('./packages/scripts/src/integration-test/config/watcher.json', cfg);
  updateConfig('./packages/scripts/src/integration-test/config/verifier1.json', cfg);
  updateConfig('./packages/scripts/src/integration-test/config/verifier2.json', cfg);
}

function updateConfig(cfgPath: string, cfg: Config) {
  nconf.env().file({ file: cfgPath });
  nconf.set('forceBridge:eth:contractAddress', cfg.eth.contractAddress);
  nconf.set('forceBridge:ckb:deps', cfg.ckb.deps);
  nconf.set('forceBridge:ckb:ownerLockHash', cfg.ckb.ownerLockHash);
  nconf.set('forceBridge:ckb:startBlockHeight', cfg.ckb.startBlockHeight);
  nconf.set('forceBridge:ckb:multisigType', cfg.ckb.multisigType);
  nconf.save();
}

main();
