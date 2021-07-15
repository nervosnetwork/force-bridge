#!/usr/bin/env bash

set -ex

CURRENT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
PROJECT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && cd ../.. && pwd )"
OFFCHAIN_MODULES_DIR="${PROJECT_DIR}/offchain-modules"
INTEGRATION_TEST_WORKDIR="${PROJECT_DIR}/workdir/integration"

export PROJECT_DIR
export CKB_URL='http://127.0.0.1:8114'
export CKB_INDEXER_URL='http://127.0.0.1:8116';
export CKB_PRIV_KEY="0xa800c82df5461756ae99b5c6677d019c98cc98c7786b80d7b2e77256e46ea1fe"
export ETH_URL='http://127.0.0.1:8545'
export ETH_PRIV_KEY="0xc4ad657963930fbff2e9de3404b30a4e21432c89952ed430b56bf802945ed37a"
export CONFIG_PATH="${INTEGRATION_TEST_WORKDIR}/configs"
export MULTISIG_CONFIG_PATH="${CONFIG_PATH}/multisig.json"
export FORCE_BRIDGE_KEYSTORE_PASSWORD=123456
export MULTISIG_NUMBER=5
export THRESHOLD=3
export FORCE_BRIDGE_RPC_URL="http://127.0.0.1:8080/force-bridge/api/v1"
export FORCE_BRIDGE_KEYSTORE_PATH="${INTEGRATION_TEST_WORKDIR}/configs/keystore.json"
export DOCKER_DIR=/tmp/force-bridge
export FORCECLI="npx ts-node packages/app-cli/src/index.ts"

function install_and_build {
  cd "${OFFCHAIN_MODULES_DIR}"
  yarn build
  yarn install
  # chmod +x node_modules/.bin/forcecli
}

function clean_db {
  for i in `seq 1 ${MULTISIG_NUMBER}`
  do
    docker exec docker_mysql_1 bash -c "mysql -uroot -proot -e 'drop database if exists verifier${i}'"
  done
  docker exec docker_mysql_1 bash -c "mysql -uroot -proot -e 'drop database if exists collector; drop database if exists watcher;'"
}

function clean_config {
  rm -rf ${INTEGRATION_TEST_WORKDIR}/configs
}

# clean
function clean_all {
  rm -rf ${INTEGRATION_TEST_WORKDIR}
  clean_db
}

function generate_multisig {
  cd "${OFFCHAIN_MODULES_DIR}"
  mkdir -p ${CONFIG_PATH}
  cp ${CURRENT_DIR}/config/* ${CONFIG_PATH}
  npx ts-node "${OFFCHAIN_MODULES_DIR}"/packages/scripts/src/generate_account.ts
  npx ts-node "${OFFCHAIN_MODULES_DIR}"/packages/scripts/src/generate_multisig.ts
}

function deploy {
  # deploy eth contracts
  cd "${PROJECT_DIR}/eth-contracts"
  yarn deploy

  cd "${OFFCHAIN_MODULES_DIR}"
  # deploy ckb contracts
  npx ts-node ./packages/scripts/src/deploy_ckb.ts
  ## create owner cell
  npx ts-node ./packages/x/src/ckb/tx-helper/multisig/deploy.ts
}

function generate_configs {
  # generate configs
  cd "${OFFCHAIN_MODULES_DIR}"
  npx ts-node "${OFFCHAIN_MODULES_DIR}"/packages/scripts/src/generate_config.ts
}

function create_db {
  # create database
  for i in `seq 1 ${MULTISIG_NUMBER}`
  do
    docker exec docker_mysql_1 bash -c "mysql -uroot -proot -e 'create database verifier${i}'"
  done
  docker exec docker_mysql_1 bash -c "mysql -uroot -proot -e 'create database collector; create database watcher; show databases;'"
}

function start_multisign_docker {
  mkdir -p $DOCKER_DIR
  cd ${OFFCHAIN_MODULES_DIR}/packages/app-multisign-server/docker
  docker build -t multisign-server .
  for i in `seq 1 $MULTISIG_NUMBER`
  do
    mkdir -p verifier${i}
    cp docker-compose.yml verifier${i}/
    cd verifier${i}
    PORT=800${i} VERIFIER_INDEX=${i} docker-compose up -d
    cd .. && rm -rf verifier${i}
  done
}

function wait_for_multisign_server {
  for i in `seq 1 $MULTISIG_NUMBER`
  do
    while [ 1 == 1 ]
    do
      if [ -f ${DOCKER_DIR}/${i}_ok ];then
        break
      fi
      sleep 5
    done
  done
}

function start_service {
  trap 'kill $(jobs -p)' EXIT
  cd "${OFFCHAIN_MODULES_DIR}"
  mkdir -p ${INTEGRATION_TEST_WORKDIR}/logs
  # for i in `seq 1 ${MULTISIG_NUMBER}`
  # do
  #   ${FORCECLI} verifier -cfg ${CONFIG_PATH}/verifier${i}.json &
  # done
  ${FORCECLI} collector -cfg ${CONFIG_PATH}/collector.json &
  sleep 5
  CONFIG_PATH=${CONFIG_PATH}/watcher.json npx ts-node ./packages/app-rpc-server/src/index.ts &
#  CONFIG_PATH=${CONFIG_PATH}/watcher.json npx ts-node ./packages/scripts/src/integration-test/eth.ts
}

function ci_test {
  sleep 20
  CONFIG_PATH=${CONFIG_PATH}/watcher.json npx ts-node ./packages/scripts/src/integration-test/eth_batch_test.ts
  CONFIG_PATH=${CONFIG_PATH}/watcher.json npx ts-node ./packages/scripts/src/integration-test/rpc-ci.ts
}

#clean_all
#clean_config
#clean_db
install_and_build
generate_multisig
deploy
generate_configs
create_db
start_multisign_docker
wait_for_multisign_server
start_service
ci_test
