#!/bin/bash

#copy local path to docker
TEMP_DIR=/usr/app
WORK_SPACE=/usr/app/workspace

function prepare {
  mkdir -p ${WORK_SPACE}/force-bridge/workdir/integration/
  cp -r ${TEMP_DIR}/force-bridge/workdir/integration/configs /usr/app/workspace/force-bridge/workdir/integration/

  mkdir -p ${WORK_SPACE}/force-bridge/offchain-modules
  cd ${TEMP_DIR}/force-bridge/offchain-modules
  for file in ${TEMP_DIR}/force-bridge/offchain-modules/*
  do
    temp_file=`basename $file`
    if [ $temp_file == "node_modules" ];then
      continue
    fi
    cp -r $temp_file ${WORK_SPACE}/force-bridge/offchain-modules/
  done

  cd ${WORK_SPACE} && yarn && yarn build

  export CONFIG_PATH=${WORK_SPACE}/force-bridge/workdir/integration/configs
  export FORCE_BRIDGE_KEYSTORE_PATH=${WORK_SPACE}/force-bridge/workdir/integration/configs/keystore.json
}

function generate_verifier_config {
  npx ts-node ${WORK_SPACE}/force-bridge/offchain-modules/packages/scripts/src/generate_verifier.ts
}

function start_verifier {
  CONFIG_PATH=${CONFIG_PATH}/verifier.json npx ts-node ${WORK_SPACE}/force-bridge/offchain-modules/packages/app-multisign-server/src/index.ts 
}

generate_verifier_config
sleep 31536000
start_verifier