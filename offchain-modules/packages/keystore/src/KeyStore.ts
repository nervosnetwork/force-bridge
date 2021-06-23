import { createStore, KeyStore as _KeyStore, KeysData } from 'key-store';

function noop(): void {
  return;
}

export type Encrypted = KeysData<string>;

export class KeyStore {
  #password: string;
  #isDecrypted = false;

  private readonly store: _KeyStore<string, string>;

  constructor(encrypted: KeysData<string>) {
    this.store = createStore(noop, encrypted);
  }

  static createFromPairs(keyPairs: Record<string, string>, password: string): KeyStore {
    const raw = createStore(noop);

    const savedKeys = Object.entries(keyPairs).map(([id, privateKey]) => ({
      keyID: id,
      password,
      privateData: privateKey,
    }));
    void raw.saveKeys(savedKeys);

    const encrypted = raw
      .getKeyIDs()
      .reduce((result, id) => Object.assign(result, { [id]: raw.getRawKeyData(id) }), {} as KeysData<string>);

    return new KeyStore(encrypted);
  }

  checkIsDecrypted(): boolean {
    return this.#isDecrypted;
  }

  decrypt(password: string): void {
    const ids = this.store.getKeyIDs();
    if (ids.length <= 0) return;

    // try decrypt something private to check if password is correct
    this.store.getPrivateKeyData(ids[0], password);

    this.#password = password;
    this.#isDecrypted = true;
  }

  getDecryptedByKeyID(id: string): string {
    return this.store.getPrivateKeyData(id, this.#password);
  }

  listKeyIDs(): string[] {
    return this.store.getKeyIDs();
  }

  getEncryptedData(): KeysData<string> {
    return this.store
      .getKeyIDs()
      .reduce((result, id) => Object.assign(result, { [id]: this.store.getPublicKeyData(id) }), {} as KeysData<string>);
  }
}
