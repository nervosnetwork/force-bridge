import { createStore, KeyStore as _KeyStore, KeysData } from 'key-store';

function noop(): void {
  return;
}

export type Encrypted = KeysData<string>;
type KeyPair = Record<string, string>;
type KeyIDOf<T> = T extends Record<infer X, unknown> ? X : string;

export class KeyStore<KeyID extends string = string> {
  #password: string;
  #isDecrypted = false;

  private readonly store: _KeyStore<string, string>;

  constructor(encrypted: KeysData<string>) {
    this.store = createStore(noop, encrypted);
  }

  static createFromPairs<P extends KeyPair>(keyPairs: P, password: string): KeyStore<KeyIDOf<P>> {
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

  getDecryptedByKeyID(id: KeyID): string {
    const decrypted = this.store.getPrivateKeyData(id, this.#password);
    if (!decrypted) throw new Error(`cannot find ${id} in the keystore`);

    return decrypted;
  }

  listKeyIDs(): string[] {
    return this.store.getKeyIDs();
  }

  getEncryptedData(): KeysData<string> {
    return this.store
      .getKeyIDs()
      .reduce((result, id) => Object.assign(result, { [id]: this.store.getRawKeyData(id) }), {} as KeysData<string>);
  }
}
