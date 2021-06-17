#!/bin/bash
/* eslint-disable */

const childProcess = require('child_process');
const lintStaged = require('lint-staged');
const { resolveOffChainModulesPath } = require('@force-bridge/internal');

async function main() {
  try {
    childProcess.execSync('yarn install && yarn run build', {
      cwd: resolveOffChainModulesPath(),
      stdio: 'inherit',
    });
  } catch (e) {
    process.exit(1);
  }

  const eslintConfigPath = resolveOffChainModulesPath('.eslintrc.next.js');
  const lintSucceeded = await lintStaged({
    cwd: resolveOffChainModulesPath(),
    config: { '*.ts': `eslint --config ${eslintConfigPath}` },
  });

  process.exit(lintSucceeded ? 0 : 1);
}

main();
