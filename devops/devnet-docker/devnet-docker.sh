#!/usr/bin/env bash

set -ex

CURRENT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
export PROJECT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && cd ../.. && pwd )"
OFFCHAIN_MODULES_DIR="${PROJECT_DIR}/offchain-modules"
INTEGRATION_TEST_WORKDIR="${PROJECT_DIR}/workdir/integration-docker"

export CONFIG_PATH="${INTEGRATION_TEST_WORKDIR}"
export FORCE_BRIDGE_KEYSTORE_PASSWORD=123456
export MULTISIG_NUMBER=5
export FORCE_BRIDGE_RPC_URL="http://127.0.0.1:8080/force-bridge/api/v1"
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

# clean
function clean_all {
  rm -rf ${INTEGRATION_TEST_WORKDIR}
  clean_db
}

function generate_configs {
  # generate configs
  cd "${OFFCHAIN_MODULES_DIR}"
  npx ts-node "${OFFCHAIN_MODULES_DIR}"/packages/scripts/src/integration-test/integration.ts
}

function create_db {
  # create database
  for i in `seq 1 ${MULTISIG_NUMBER}`
  do
    docker exec docker_mysql_1 bash -c "mysql -uroot -proot -e 'create database verifier${i}'"
  done
  docker exec docker_mysql_1 bash -c "mysql -uroot -proot -e 'create database collector; create database watcher; show databases;'"
}

function start_service {
  trap 'kill $(jobs -p)' EXIT
  cd "${OFFCHAIN_MODULES_DIR}"
  for i in `seq 1 ${MULTISIG_NUMBER}`
  do
    ${FORCECLI} verifier -cfg ${CONFIG_PATH}/verifier${i}/force_bridge.json &
  done
  ${FORCECLI} collector -cfg ${CONFIG_PATH}/collector/force_bridge.json &
  sleep 5
  CONFIG_PATH=${CONFIG_PATH}/watcher/force_bridge.json npx ts-node ./packages/app-rpc-server/src/index.ts &
}

function ci_test {
  sleep 20
  CONFIG_PATH=${CONFIG_PATH}/watcher/force_bridge.json npx ts-node ./packages/scripts/src/integration-test/eth_batch_test.ts
  CONFIG_PATH=${CONFIG_PATH}/watcher/force_bridge.json npx ts-node ./packages/scripts/src/integration-test/rpc-ci.ts
}

function start_docker {
#  docker run --rm -v ${OFFCHAIN_MODULES_DIR}:/app -v ${INTEGRATION_TEST_WORKDIR}/docker-node-modules:/app/node_modules node:14 bash -c 'cd /app && yarn build'
  cd "${PROJECT_DIR}"/workdir/integration-docker
  docker-compose down
  docker-compose up
}

#clean_all
#clean_db
#install_and_build
#generate_configs
#create_db
#start_service
#ci_test
start_docker