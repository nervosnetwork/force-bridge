#!/bin/bash

#copy local path to docker
TEMP_DIR=/usr/app/tmp
WORK_SPACE=/usr/app/workspace

function init {
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

  cd ${WORK_SPACE}/force-bridge/offchain-modules && yarn && yarn build
}

function generate_verifier_config {
  npx ts-node ${WORK_SPACE}/force-bridge/offchain-modules/packages/scripts/src/generate_docker_verifier.ts
}

function start_verifier {
  CONFIG_PATH=${CONFIG_PATH}/verifier${VERIFIER_INDEX}.json npx ts-node ${WORK_SPACE}/force-bridge/offchain-modules/packages/app-multisign-server/src/index.ts 
}

if [ ! -d ${WORK_SPACE}/force-bridge/workdir/ ];then
  init
  touch ${WORK_SPACE}/force-bridge/init_ok
fi

export CONFIG_PATH=${WORK_SPACE}/force-bridge/workdir/integration/configs
export FORCE_BRIDGE_KEYSTORE_PATH=${WORK_SPACE}/force-bridge/workdir/integration/configs/keystore.json

while [ 1 == 1 ]
do
  if [ -f ${WORK_SPACE}/force-bridge/init_ok ];then
    generate_verifier_config
    touch ${WORK_SPACE}/force-bridge/${VERIFIER_INDEX}_ok
    start_verifier
    break
  fi
  sleep 10
done
