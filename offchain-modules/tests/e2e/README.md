

# before you start

start the process : force-bridge testnet

## run test case


```
cd force-bridge/offchain-modules/tests/e2e
mv config_demo.json config.json
cd force-bridge/offchain-modules/tests/e2e/src
yarn exec http-server
cd force-bridge/offchain-modules/tests/e2e/
yarn
yarn e2e-test
```


