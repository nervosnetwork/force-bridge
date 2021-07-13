PROJECT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && cd ../.. && pwd )"
MULTISIGN_DOCKER_DIR="${PROJECT_DIR}/offchain-modules/packages/app-multisign-server/docker"

MULTISIG_NUMBER=2

function start_multisign {
  cd $MULTISIGN_DOCKER_DIR
  for i in `seq 1 $MULTISIG_NUMBER`
  do
    mkdir -p verifier${i}
    cp docker-compose.yml verifier${i}/
    cd verifier${i}
    PORT=800${i} VERIFIER_INDEX=${i} docker-compose up -d
    cd .. && rm -f verifier${i}
  done
}

start_multisign