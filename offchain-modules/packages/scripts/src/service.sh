#!/usr/bin/env bash

set -e
set -x

PROJECT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && cd ../../../../ && pwd )"

FORCE_BRIDGE_CLI="yarn forcecli"
rpc_port=8080
watcher_config="${PROJECT_DIR}/offchain-modules/packages/scripts/src/integration-test/config/watcher.json"

first_signer_port=8090
first_signer_config="${PROJECT_DIR}/offchain-modules/packages/scripts/src/integration-test/config/verifier1.json"

second_signer_port=8091
second_signer_config="${PROJECT_DIR}/offchain-modules/packages/scripts/src/integration-test/config/verifier2.json"

collector_config="${PROJECT_DIR}/offchain-modules/packages/scripts/src/integration-test/config/collector.json"

build_cli(){
  cd "${PROJECT_DIR}/offchain-modules" && yarn && yarn build
}

deploy_contract(){
	cd "${PROJECT_DIR}/offchain-modules" && yarn --frozen-lockfile && yarn build
	cd "${PROJECT_DIR}/offchain-modules" && yarn deploy
	cd "${PROJECT_DIR}/offchain-modules" && yarn init-multisig
  sleep 5
  cd "${PROJECT_DIR}/offchain-modules" && yarn ci-config
}

start_service_by_pm2(){
  build_cli
  cd "${PROJECT_DIR}/offchain-modules/packages/app-cli/"
  pm2 start --name multisig-rpc-server "${FORCE_BRIDGE_CLI} rpc --port ${rpc_port} --config ${watcher_config}"
  pm2 start --name multisig-signer-1 "${FORCE_BRIDGE_CLI} signer --port ${first_signer_port} --config ${first_signer_config}"
  pm2 start --name multisig-signer-2 "${FORCE_BRIDGE_CLI} signer --port ${second_signer_port} --config ${second_signer_config}"
  pm2 start --name multisig-relayer "${FORCE_BRIDGE_CLI} relayer --config ${collector_config}"
}

start_service_by_daemon(){
  build_cli
  cd "${PROJECT_DIR}/offchain-modules/packages/app-cli/"
  ${FORCE_BRIDGE_CLI} rpc --port ${rpc_port} --config "${watcher_config}" 2>&1 &
  ${FORCE_BRIDGE_CLI} signer --port ${first_signer_port} --config "${first_signer_config}" 2>&1 &
  ${FORCE_BRIDGE_CLI} signer --port ${second_signer_port} --config "${second_signer_config}" 2>&1 &
  ${FORCE_BRIDGE_CLI} relayer --config "${collector_config}" 2>&1 &
}

stop_service_by_daemon(){
  ps aux | grep "${FORCE_BRIDGE_CLI}" | grep -v grep | awk '{print $2}' | xargs kill -9
}

ci_flow(){
  cd "${PROJECT_DIR}/offchain-modules" && yarn xchain-test
}

while getopts "rcsf:" opt; do
  case $opt in
  	r)
	      echo "set remove services params"
	      REMOVE_SERVICES="Y"
	      ;;
  	c)
	      echo "set deploy_contract params"
	      DEPLOY_CONTRACT="Y"
	      ;;
    s)
        echo "set start services: relayer rpc multi-sign-server params"
        START_SERVICES="Y"
        ;;
    f)
        echo "set ci flow params"
        CI_FLOW="Y"
        ;;
    \?)
        echo "Invalid option: -$OPTARG"
        ;;
  esac
done

main(){
  if [ ! -z "${REMOVE_SERVICES}" ]; then
        echo "remove service now"
        stop_service_by_daemon
  fi

  if [ ! -z "${DEPLOY_CONTRACT}" ]; then
        echo "deploy_contract now"
        deploy_contract
  fi

	if [ ! -z "${START_SERVICES}" ]; then
        echo "start service now"
        start_service_by_daemon
  fi

	if [ ! -z "${CI_FLOW}" ]; then
        echo "start ci flow now"
        ci_flow
  fi
}

main

