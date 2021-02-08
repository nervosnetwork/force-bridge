#!/usr/bin/env bash
echo $CODECOV_TOKEN
cargo tarpaulin -o html -o xml --output-dir ./target/tarpaulin
bash <(curl -s https://codecov.io/bash) -f ./target/tarpaulin/cobertura.xml
