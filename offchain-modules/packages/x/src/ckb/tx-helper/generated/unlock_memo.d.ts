export interface CastToArrayBuffer {
  toArrayBuffer(): ArrayBuffer;
}

export type CanCastToArrayBuffer = ArrayBuffer | CastToArrayBuffer;

export interface CreateOptions {
  validate?: boolean;
}

export interface UnionType {
  type: string;
  value: any;
}

export function SerializeBytes(value: CanCastToArrayBuffer): ArrayBuffer;
export class Bytes {
  constructor(reader: CanCastToArrayBuffer, options?: CreateOptions);
  validate(compatible?: boolean): void;
  indexAt(i: number): number;
  raw(): ArrayBuffer;
  length(): number;
}

export function SerializeBurnId(value: object): ArrayBuffer;
export class BurnId {
  constructor(reader: CanCastToArrayBuffer, options?: CreateOptions);
  validate(compatible?: boolean): void;
  getBurnTxHash(): Bytes;
  getLogIndex(): Bytes;
}

export function SerializeBurnIds(value: Array<object>): ArrayBuffer;
export class BurnIds {
  constructor(reader: CanCastToArrayBuffer, options?: CreateOptions);
  validate(compatible?: boolean): void;
  indexAt(i: number): BurnId;
  length(): number;
}

export function SerializeUnlockMemo(value: object): ArrayBuffer;
export class UnlockMemo {
  constructor(reader: CanCastToArrayBuffer, options?: CreateOptions);
  validate(compatible?: boolean): void;
  getXchain(): number;
  getBurnIds(): BurnIds;
}
