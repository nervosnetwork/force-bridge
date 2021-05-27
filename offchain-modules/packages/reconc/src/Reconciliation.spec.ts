import test from 'ava';
import { BigNumber } from 'bignumber.js';
import { Reconciliation } from '.';

test('test Reconciliation', (t) => {
  t.true(new Reconciliation([], []).checkBalanced(), 'empty record should be balanced');
  t.true(
    new Reconciliation(
      [
        {
          amount: (new BigNumber('0x016345785d8a0000') as unknown) as string,
          txId: '0xa776aebf68482d52715a0eb5e9fb8136322ef32d569af57ac9dde2c05681a8ec',
        },
      ],
      [
        {
          txId: '0x0e2bc8bc76a8d246c837bc8ea560b26fca042bc31ac06a5b7fd01a6e9a509d34',
          amount: '100000000000000000',
          recipient: 'ckt1qyqyph8v9mclls35p6snlaxajeca97tc062sa5gahk',
          fee: '0',
        },
      ],
    ).checkBalanced(),
    'ci test ',
  );
});
