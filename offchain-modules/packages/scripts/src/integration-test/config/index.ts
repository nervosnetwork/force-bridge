import { Config } from '@force-bridge/x/dist/config';
import nconf from 'nconf';

const firstCkbMultiSigAddr = 'ckt1qyqvsv5240xeh85wvnau2eky8pwrhh4jr8ts8vyj37';
const firstCkbMultiSigServerHost = 'http://127.0.0.1:3090';
const secondCkbMultiSigAddr = 'ckt1qyqywrwdchjyqeysjegpzw38fvandtktdhrs0zaxl4';
const secondCkbMultiSigServerHost = 'http://127.0.0.1:8091';

function main() {
  const configPath = process.env.CONFIG_PATH || './config.json';
  nconf.env().file({ file: configPath });
  const cfg: Config = nconf.get('forceBridge');

  updateConfig('./packages/scripts/src/integration-test/config/collector.json', cfg);
  updateConfig('./packages/scripts/src/integration-test/config/watcher.json', cfg);
  updateConfig('./packages/scripts/src/integration-test/config/verifier1.json', cfg);
  updateConfig('./packages/scripts/src/integration-test/config/verifier2.json', cfg);

  updateETHCollectorConfig('./packages/scripts/src/integration-test/config/collector.json', cfg);
  updateETHVerifier1Config('./packages/scripts/src/integration-test/config/verifier1.json', cfg);
  updateETHVerifier2Config('./packages/scripts/src/integration-test/config/verifier2.json', cfg);
}

function updateConfig(cfgPath: string, cfg: Config) {
  nconf.env().file({ file: cfgPath });
  nconf.set('forceBridge:eth:contractAddress', cfg.eth.contractAddress);
  nconf.set('forceBridge:eth:rpcUrl', cfg.eth.rpcUrl);
  nconf.set('forceBridge:eth:assetWhiteList', cfg.eth.assetWhiteList);
  nconf.set('forceBridge:eth:batchUnlock', cfg.eth.batchUnlock);
  nconf.set('forceBridge:eth:startBlockHeight', cfg.eth.startBlockHeight);
  nconf.set('forceBridge:eth:confirmNumber', cfg.eth.confirmNumber);

  nconf.set('forceBridge:ckb:ckbRpcUrl', cfg.ckb.ckbRpcUrl);
  nconf.set('forceBridge:ckb:ckbIndexerUrl', cfg.ckb.ckbIndexerUrl);
  nconf.set('forceBridge:ckb:multisigScript', cfg.ckb.multisigScript);
  nconf.set('forceBridge:ckb:deps', cfg.ckb.deps);
  nconf.set('forceBridge:ckb:ownerLockHash', cfg.ckb.ownerLockHash);
  nconf.set('forceBridge:ckb:startBlockHeight', cfg.ckb.startBlockHeight);
  nconf.set('forceBridge:ckb:multisigType', cfg.ckb.multisigType);
  nconf.set('forceBridge:ckb:confirmNumber', cfg.ckb.confirmNumber);
  nconf.save();
}

function updateETHCollectorConfig(cfgPath: string, cfg: Config) {
  nconf.env().file({ file: cfgPath });
  nconf.set('forceBridge:eth:multiSignAddresses', cfg.eth.multiSignAddresses);

  const multiSignHosts = [
    {
      address: cfg.eth.multiSignAddresses[0],
      host: `${firstCkbMultiSigServerHost}/force-bridge/sign-server/api/v1`,
    },
    {
      address: cfg.eth.multiSignAddresses[1],
      host: `${secondCkbMultiSigServerHost}/force-bridge/sign-server/api/v1`,
    },
  ];

  nconf.set('forceBridge:eth:multiSignHosts', multiSignHosts);
  nconf.set('forceBridge:eth:multiSignThreshold', cfg.eth.multiSignThreshold);
  nconf.set('forceBridge:eth:privateKey', cfg.eth.privateKey);
  const ckbmultiSignHosts = [
    {
      address: firstCkbMultiSigAddr,
      host: `${firstCkbMultiSigServerHost}/force-bridge/sign-server/api/v1`,
    },
    {
      address: secondCkbMultiSigAddr,
      host: `${secondCkbMultiSigServerHost}/force-bridge/sign-server/api/v1`,
    },
  ];
  nconf.set('forceBridge:ckb:multiSignHosts', ckbmultiSignHosts);
  nconf.save();
}

function updateETHVerifier1Config(cfgPath: string, cfg: Config) {
  nconf.env().file({ file: cfgPath });
  nconf.set('forceBridge:eth:multiSignAddresses', cfg.eth.multiSignAddresses);

  const multiSignKeys = [
    {
      address: cfg.eth.multiSignAddresses[0],
      privKey: 'privkeys/eth-multisig-1',
    },
  ];
  nconf.set('forceBridge:eth:multiSignKeys', multiSignKeys);

  const ckbmultiSignKeys = [
    {
      address: firstCkbMultiSigAddr,
      privKey: 'privkeys/ckb-multisig-1',
    },
  ];
  nconf.set('forceBridge:ckb:multiSignKeys', ckbmultiSignKeys);
  nconf.save();
}

function updateETHVerifier2Config(cfgPath: string, cfg: Config) {
  nconf.env().file({ file: cfgPath });
  nconf.set('forceBridge:eth:multiSignAddresses', cfg.eth.multiSignAddresses);

  const multiSignKeys = [
    {
      address: cfg.eth.multiSignAddresses[1],
      privKey: 'privkeys/eth-multisig-2',
    },
  ];
  nconf.set('forceBridge:eth:multiSignKeys', multiSignKeys);

  const ckbmultiSignKeys = [
    {
      address: secondCkbMultiSigAddr,
      privKey: 'privkeys/ckb-multisig-2',
    },
  ];
  nconf.set('forceBridge:ckb:multiSignKeys', ckbmultiSignKeys);
  nconf.save();
}
main();
