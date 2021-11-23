#!/usr/bin/env bash

main() {
  DEPLOY_CONFIG="/app/workdir/dev-docker/deployConfig.json"
  RES=$(node -e "const fs=require('fs');
    const s=JSON.parse(fs.readFileSync('$DEPLOY_CONFIG'));
    console.log(s.ckbDeps.pwLock.cellDep.outPoint.txHash+' '+s.ckbDeps.pwLock.script.codeHash);")
  HASHES=(`echo $RES | tr ' ' ' '`)
  echo "
REACT_APP_BRIDGE_RPC_URL=http://localhost:3199/force-bridge/api/v1
REACT_APP_CKB_RPC_URL=http://localhost:3001/rpc
REACT_APP_CKB_CHAIN_ID=2
REACT_APP_PWLOCK_OUTPOINT_TXHASH=${HASHES[0]}
REACT_APP_PWLOCK_OUTPOINT_INDEX=0x0
REACT_APP_PWLOCK_DEP_TYPE=code
REACT_APP_PWLOCK_CODE_HASH=${HASHES[1]}
REACT_APP_PWLOCK_HASH_TYPE=data
REACT_APP_ETHEREUM_ENABLE_CHAIN_ID=1234
REACT_APP_ETHEREUM_ENABLE_CHAIN_NAME=local
" > .env.local
  git clone https://github.com/nervosnetwork/force-bridge-ui.git -b develop /force-bridge-ui && \
  cd /force-bridge-ui && yarn install && yarn build:lib && \
  cd apps/ui && echo "${uiEnvLocal}" > .env.local && \
  yarn run build && cp -rf build /app/workdir/dev-docker/ui
}

main
