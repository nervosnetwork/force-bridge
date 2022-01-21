import { SigError, SigErrorCode } from './error';

export class SigResponse<T> {
  Data?: T;
  Error: SigError;

  constructor(err: SigError, data?: T) {
    this.Error = err;
    if (data) {
      this.Data = data;
    }
  }

  static fromSigError<T>(code: SigErrorCode, message?: string): SigResponse<T> {
    return new SigResponse(new SigError(code, message));
  }
  static fromData<T>(data: T): SigResponse<T> {
    return new SigResponse(new SigError(SigErrorCode.Ok), data);
  }
}
