import fs from 'fs';
import { KeyStore } from '@force-bridge/keystore';
import { nonNullable } from '@force-bridge/x';
import commander from 'commander';

export const keystoreCmd = new commander.Command('keystore');

// prettier-ignore
keystoreCmd
  .command('encrypt')
  .description('encrypt a json file into a encrypted keystore')
  .requiredOption('-p, --password <password>', 'password of the keystore')
  .option('-s, --source <source>', 'path of a json file, the key is the name of a private key and value is the private key', './keys.json' )
  .option('-d, --dist <dist>', 'path of the output file', './keystore.json')
  .action(convert);

function asserts(condition: unknown, message: string): asserts condition {
  if (condition) return;
  // eslint-disable-next-line no-console
  console.error(message);
  process.exit(1);
}

async function convert(opts: Record<string, string>): Promise<void> {
  const password = nonNullable(opts.password);
  const source = nonNullable(opts.source);
  const dist = nonNullable(opts.dist);

  asserts(fs.existsSync(source), `${source} is not exists`);
  asserts(!!password, 'password is not valid');

  const pairs: Record<string, string> = JSON.parse(fs.readFileSync(source).toString());
  const store = KeyStore.createFromPairs(pairs, password);

  fs.writeFileSync(dist, JSON.stringify(store.getEncryptedData()));
}
