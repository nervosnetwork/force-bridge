import { nonNullable } from '@force-bridge/x';
import {
  parsePrivateKey,
  privateKeyToCkbAddress,
  privateKeyToCkbPubkeyHash,
  privateKeyToEthAddress,
} from '@force-bridge/x/dist/utils';
import commander from 'commander';

export const configCmd = new commander.Command('config');

// prettier-ignore
configCmd
    .command('generate')
    .description('generate multisig config')
    .requiredOption('-k --privkey <privkey>', 'private key or private key path')
    .action(convert);

async function convert(opts: Record<string, string>): Promise<void> {
  const privkeyParam = nonNullable(opts.privkey);
  const privkey = parsePrivateKey(privkeyParam);

  const multiConfig = {
    ethAddress: privateKeyToEthAddress(privkey),
    ckbPubkeyHash: privateKeyToCkbPubkeyHash(privkey),
    ckbAddress: privateKeyToCkbAddress(privkey),
  };
  console.log(`multiConfig:\n${JSON.stringify(multiConfig, null, 2)}`);
}
