import { startMonitor } from '@force-bridge/app-monitor/dist/monitor';
import { nonNullable } from '@force-bridge/x';
import commander from 'commander';

const defaultConfig = './config.json';

export const monitorCmd = new commander.Command('monitor')
  .option('-cfg, --config <config>', 'config path of monitor', defaultConfig)
  .action(monitor);

async function monitor(opts: Record<string, string>) {
  const configPath = nonNullable(opts.config || defaultConfig);
  await startMonitor(configPath);
}
