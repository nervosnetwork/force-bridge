MULTISIG_NUMBER=5

function stop_multisign {
  for i in `seq 1 $MULTISIG_NUMBER`
  do
    docker stop verifier${i}
    docker rm -f verifier${i}
  done
}

stop_multisign