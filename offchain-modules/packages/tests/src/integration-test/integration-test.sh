#!/usr/bin/env bash

set -ex

CURRENT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
PROJECT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && cd ../../../.. && pwd )"
TEST_DIR="${PROJECT_DIR}/packages/tests"
cd "${PROJECT_DIR}"
export CKB_URL='http://127.0.0.1:8114'
export CKB_INDEXER_URL='http://127.0.0.1:8116';
export ETH_URL='http://127.0.0.1:8545'
export CKB_PRIV_KEY="${CURRENT_DIR}/privkeys/ckb"
export MULTISIG_CONFIG_PATH="${CURRENT_DIR}/config/multisig.json"

## deploy ckb contracts
#npx ts-node ./packages/scripts/src/deploy_ckb.ts
### create owner cell
#npx ts-node ./packages/x/src/ckb/tx-helper/multisig/deploy.ts
## deploy eth contracts
#cd ../eth-contracts
#yarn deploy

# generate configs
npx ts-node "${CURRENT_DIR}"/generate_ci_config.ts
cp -r "${CURRENT_DIR}/privkeys" "${TEST_DIR}/generated/ci"

## create database
docker exec -it docker_mysql_1 bash -c "mysql -uroot -proot -e 'drop database if exists collector; drop database if exists verifier1; drop database if exists verifier2; drop database if exists watcher;'"
docker exec -it docker_mysql_1 bash -c "mysql -uroot -proot -e 'create database collector; create database verifier1; create database verifier2; create database watcher; show databases;'"

# start service
cd "${PROJECT_DIR}"
LOG_DIR="${TEST_DIR}/generated/ci/logs"
mkdir -p ${LOG_DIR}
CONFIG_PATH=${TEST_DIR}/generated/ci/collector.json ts-node ./packages/app-relayer/src/index.ts > ${LOG_DIR}/collector.log  2>&1  & \
CONFIG_PATH=${TEST_DIR}/generated/ci/verifier1.json ts-node ./packages/app-multisign-server/src/index.ts > ${LOG_DIR}/verifier1.log  2>&1  & \
CONFIG_PATH=${TEST_DIR}/generated/ci/verifier2.json ts-node ./packages/app-multisign-server/src/index.ts > ${LOG_DIR}/verifier2.log 2>&1 & \
CONFIG_PATH=${TEST_DIR}/generated/ci/watcher.json ts-node ./packages/tests/src/integration-test/eth.ts > ${LOG_DIR}/watcher.log 2>&1 & \
tail -f ${LOG_DIR}/* & \
wait