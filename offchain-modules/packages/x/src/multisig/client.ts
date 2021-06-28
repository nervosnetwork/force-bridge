import axios from 'axios';
import { JSONRPCResponse } from 'json-rpc-2.0';
import { collectSignaturesParams } from './multisig-mgr';

let id = new Date().getTime();
const nextId = () => {
  id++;
  return id;
};

export async function httpRequest(
  reqUrl: string,
  method: string,
  params: collectSignaturesParams,
): Promise<JSONRPCResponse> {
  const jsonRpcRequest = {
    jsonrpc: '2.0',
    method: method,
    id: nextId(),
    params: params,
  };
  return axios({
    method: 'post',
    url: reqUrl,
    data: jsonRpcRequest,
  })
    .then((response) => {
      return response.data as JSONRPCResponse;
    })
    .catch((err) => {
      throw Error(`httpRequest error:${err.toString()}`);
    });
}
