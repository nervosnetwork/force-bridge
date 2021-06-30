import fs from 'fs';
import { dummyKeyStore } from '@force-bridge/internal/dist/dummy/keystore';

function main() {
  fs.writeFileSync('keystore.json', JSON.stringify(dummyKeyStore.getEncryptedData()));
}

main();
