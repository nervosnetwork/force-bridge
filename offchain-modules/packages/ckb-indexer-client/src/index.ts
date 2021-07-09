import axios, { AxiosInstance, AxiosResponse } from 'axios';

type HexNum = string;
type IOType = 'input' | 'output';
type Bytes32 = string;

type SucceedJSONRPCResponse<T> = { jsonrpc: string; id: HexNum; result: T };
type FailedJSONRPCResponse = { jsonrpc: string; id: HexNum; error: { message: string; code: number } };
export type JSONRPCResponse<T> = SucceedJSONRPCResponse<T> | FailedJSONRPCResponse;

export type GetTransactionsResult = {
  block_number: HexNum;
  io_index: HexNum;
  io_type: IOType;
  tx_hash: Bytes32;
  tx_index: HexNum;
};

export type IndexerIterableResult<T> = {
  last_cursor: string;
  objects: T[];
};

type ScriptType = 'lock' | 'type';
type ScriptHashType = 'type' | 'data';
export type Script = {
  code_hash: Bytes32;
  args: string;
  hash_type: ScriptHashType;
};

type Uint64 = string;
type BlockNumber = string;

export type SearchKeyFilter = {
  script?: Script;
  output_data_len_range?: [Uint64, Uint64];
  output_capacity_range?: [Uint64, Uint64];
  block_range?: [BlockNumber, BlockNumber];
};

export type SearchKey = {
  script: Script;
  script_type: ScriptType;
  filter?: SearchKeyFilter;
};

export type GetTransactionParams = {
  searchKey: SearchKey;
  order?: 'asc' | 'desc';
  limit?: string;
  cursor?: string;
};

export class CKBIndexerClient {
  readonly agent: AxiosInstance;

  constructor(url: string) {
    this.agent = axios.create({ baseURL: url });
  }

  async request<Res, Param = unknown>({
    id = '0',
    method,
    params,
  }: {
    id?: string;
    method: string;
    params: Param;
  }): Promise<Res> {
    const data = { jsonrpc: '2.0', id, method, params };
    const config = { headers: { 'content-type': 'application/json' } };

    const res: AxiosResponse<JSONRPCResponse<Res>> = await this.agent.post('', data, config);

    if ('error' in res.data) {
      throw new Error('[indexer-rpc]:' + res.data.error.message);
    }

    return res.data.result;
  }

  get_transactions(params: GetTransactionParams): Promise<IndexerIterableResult<GetTransactionsResult>> {
    return this.request({
      method: 'get_transactions',
      params: [params.searchKey, params.order || 'asc', params.limit || '0x64', params.cursor || null],
    });
  }
}
