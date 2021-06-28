export class SigError {
  Code: SigErrorCode;
  Message: string;

  constructor(code: SigErrorCode, message?: string) {
    this.Code = code;
    if (message) {
      this.Message = message;
      return;
    }
    message = errMessages.get(code);
    if (message) {
      this.Message = message;
    }
  }
}

export enum SigErrorCode {
  Ok = 0,
  InvalidParams = 1000,
  InvalidRecord,
  DuplicateSign,
  TxUnconfirmed,
  TxNotFound,
  UnknownError = 9999,
}

const errMessages = new Map([
  [SigErrorCode.Ok, 'ok'],
  [SigErrorCode.InvalidParams, 'invalid sig params'],
  [SigErrorCode.InvalidRecord, 'invalid sig record'],
  [SigErrorCode.DuplicateSign, 'duplicate signature request'],
  [SigErrorCode.TxNotFound, 'tx not found'],
  [SigErrorCode.TxUnconfirmed, 'tx unconfirmed'],
  [SigErrorCode.UnknownError, 'unknown error'],
]);

export const SigErrorOk = new SigError(SigErrorCode.Ok);
