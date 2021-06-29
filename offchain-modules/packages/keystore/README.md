# @force-bridge/keystore

A simple keystore for managing the private keys

## Quick Start

### Start With JSON File

```ts
import { KeyStore } from '@force-bridge/keystore';

const password = '123456';
const store = KeyStore.createFromPairs(
  {
    Alice: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    Bob: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  },
  password,
);

const encrypted = store.getEncryptedData();
saveToFile(JSON.stringify(encrypted));
```

### Read The Encrypted JSON file

```ts
const store = new KeyStore(fs.readFileSync(filePath).toString());

// decrypt before using the keystore
store.decrypt(process.env.KEYSTORE_PASSWORD);

store.getDecryptedByKeyID('Alice');
store.getDecryptedByKeyID('Bob');
```

### Define A Function With Required Key IDs

```ts
function AliceTransferToBob(store: KeyStore<'Alice' | 'AliceSecondary'>) {
  const privateKey = store.getDecryptedByKeyID('Alice');
  const privateKey1 = store.getDecryptedByKeyID('AliceSecondary');

  // typescript would marks error if getting with an unknown key
  // const privateKeyUnknown = store.getDecryptedByKeyID('unknown-key');

  signTransaction(tx, privateKey);
  signTransaction(tx1, privateKey1);
}
```
