import { JSONRPCClient } from 'json-rpc-2.0';
import fetch from 'node-fetch/index';

export async function httpRequest(host: string, method: string, params: any): Promise<string> {
  const client = new JSONRPCClient((jsonRPCRequest) =>
    fetch(host, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(jsonRPCRequest),
    }).then((response) => {
      if (response.status === 200) {
        return response.json().then((jsonRPCResponse) => {
          client.receive(jsonRPCResponse);
        });
      } else if (jsonRPCRequest.id !== undefined) {
        return Promise.reject(new Error(response.statusText));
      }
    }),
  );
  return client.request(method, params);
}
