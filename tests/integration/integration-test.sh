#!/usr/bin/env bash

set -ex

CURRENT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
PROJECT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && cd ../.. && pwd )"
OFFCHAIN_MODULES_DIR="${PROJECT_DIR}/offchain-modules"
INTEGRATION_TEST_WORKDIR="${PROJECT_DIR}/workdir/integration"

export CKB_URL='http://127.0.0.1:8114'
export CKB_INDEXER_URL='http://127.0.0.1:8116';
export ETH_URL='http://127.0.0.1:8545'
export CKB_PRIV_KEY="${CURRENT_DIR}/privkeys/ckb"
export MULTISIG_CONFIG_PATH="${CURRENT_DIR}/config/multisig.json"
export CONFIG_PATH="${INTEGRATION_TEST_WORKDIR}"

function clean_db {
  docker exec -it docker_mysql_1 bash -c "mysql -uroot -proot -e 'drop database if exists collector; drop database if exists verifier1; drop database if exists verifier2; drop database if exists watcher;'"
}

# clean
function clean_all {
  rm -rf ${INTEGRATION_TEST_WORKDIR}
  clean_db
}

function deploy {
  # deploy eth contracts
  cd "${PROJECT_DIR}/eth-contracts"
  yarn deploy

  cd "${OFFCHAIN_MODULES_DIR}"
  yarn build
  # deploy ckb contracts
  npx ts-node ./packages/scripts/src/deploy_ckb.ts
  ## create owner cell
  npx ts-node ./packages/x/src/ckb/tx-helper/multisig/deploy.ts
}

function generate_configs {
  # generate configs
  cp -r "${CURRENT_DIR}/privkeys" "${CONFIG_PATH}"
  cp ${CURRENT_DIR}/config/* ${CONFIG_PATH}
  cd "${OFFCHAIN_MODULES_DIR}"
  npx ts-node "${OFFCHAIN_MODULES_DIR}"/packages/scripts/src/generate_config.ts
}

function create_db {
  # create database
  docker exec -it docker_mysql_1 bash -c "mysql -uroot -proot -e 'create database collector; create database verifier1; create database verifier2; create database watcher; show databases;'"
}

function start_service {
  trap 'kill $(jobs -p)' EXIT
  cd "${OFFCHAIN_MODULES_DIR}"
  mkdir -p ${INTEGRATION_TEST_WORKDIR}/logs
  CONFIG_PATH=${CONFIG_PATH}/verifier1.json ts-node ./packages/app-multisign-server/src/index.ts &
  CONFIG_PATH=${CONFIG_PATH}/verifier2.json ts-node ./packages/app-multisign-server/src/index.ts &
  CONFIG_PATH=${CONFIG_PATH}/collector.json ts-node ./packages/app-relayer/src/index.ts &
  CONFIG_PATH=${CONFIG_PATH}/watcher.json ts-node ./packages/scripts/src/integration-test/eth.ts
}

#clean_all
#clean_db
deploy
generate_configs
create_db
start_service
