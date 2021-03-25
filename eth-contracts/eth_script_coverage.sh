#!/usr/bin/env bash
echo $CODECOV_TOKEN
npx hardhat coverage
bash <(curl -s https://codecov.io/bash) -f ./coverage.json
