#!/usr/bin/env bash

set -ex

CURRENT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
PROJECT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && cd ../../../.. && pwd )"
TEST_DIR="${PROJECT_DIR}/packages/tests"

cd "${TEST_DIR}"
rm -rf generated

# clear database
#docker exec -it docker_mysql_1 bash -c "mysql -uroot -proot -e 'drop database if exists collector; drop database if exists verifier1; drop database if exists verifier2; drop database if exists watcher;'"
