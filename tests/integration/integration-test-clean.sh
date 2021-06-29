#!/usr/bin/env bash

set -ex

CURRENT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
PROJECT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && cd ../.. && pwd )"
INTEGRATION_TEST_WORKDIR="${PROJECT_DIR}/workdir/integration"

rm -rf ${INTEGRATION_TEST_WORKDIR}
