import test from 'ava';
import { KeyStore } from '.';

test('keystore', (t) => {
  // prettier-ignore
  const store = KeyStore.createFromPairs({
    Alice:   '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    Bob:     '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    Charlie: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  }, '123456');

  t.assert(store.listKeyIDs().length === 3);
  t.false(store.checkIsDecrypted());

  t.throws(() => store.getDecryptedByKeyID('Alice'), null, 'error when trying to get a decrypted before decrypted');
  t.throws(() => store.decrypt('123'), null, 'error when decrypt with an incorrect password');
  // prettier-ignore
  t.throws(() => store.getDecryptedByKeyID('Bob'), null, 'error when trying to get a decrypted after incorrect decrypt');

  store.decrypt('123456');
  t.true(store.checkIsDecrypted());

  t.is('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', store.getDecryptedByKeyID('Alice'));
  t.is('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', store.getDecryptedByKeyID('Bob'));
  t.is('0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', store.getDecryptedByKeyID('Charlie'));
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  t.throws(() => store.getDecryptedByKeyID('nonexistent'), null, 'error when trying to get a nonexistent item');
});
