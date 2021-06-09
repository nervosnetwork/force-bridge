export function boom(message?: string): never {
  throw new Error(message);
}

export function asserts(condition: unknown, err?: string | Error | (() => never)): asserts condition {
  if (condition) return;
  if (typeof err === 'function') err();
  if (typeof err === 'string') boom(err);
  if (err instanceof Error) throw err;

  boom();
}

export function nonNullable<X>(x: X): NonNullable<X> {
  asserts(x != null);

  return x as NonNullable<X>;
}
