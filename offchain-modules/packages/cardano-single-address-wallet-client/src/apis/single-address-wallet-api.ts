/* tslint:disable */
/* eslint-disable */
/**
 * Manually written, based on WalletsApi
 */
import globalAxios, { AxiosPromise, AxiosInstance } from 'axios';
import { Configuration } from '../configuration';
// Some imports not used depending on template conditions
// @ts-ignore
import { BASE_PATH, COLLECTION_FORMATS, RequestArgs, BaseAPI, RequiredError } from '../base';
import { ApiSingleAddressWalletPostData } from '../models';
import { ApiSingleAddressWallet } from '../models';
// import { ApiConstructTransaction, TransactionFee } from '../models';
import { ApiTransaction, ApiPostTransactionFeeData, ApiCoinSelection } from 'cardano-wallet-js';
/**
 * SingleAddressWalletsApi - axios parameter creator
 * @export
 */
export const SingleAddressWalletsApiAxiosParamCreator = function (configuration?: Configuration) {
  return {
    /**
     * <p align=\"right\">status: <strong>stable</strong></p>
     * @summary Delete
     * @param {string} walletId
     * @param {*} [options] Override http request option.
     * @throws {RequiredError}
     */
    deleteWallet: async (walletId: string, options: any = {}): Promise<RequestArgs> => {
      // verify required parameter 'walletId' is not null or undefined
      if (walletId === null || walletId === undefined) {
        throw new RequiredError(
          'walletId',
          'Required parameter walletId was null or undefined when calling deleteWallet.',
        );
      }
      const localVarPath = `/single-address-wallets/{walletId}`.replace(
        `{${'walletId'}}`,
        encodeURIComponent(String(walletId)),
      );
      // use dummy base URL string because the URL constructor only accepts absolute URLs.
      const localVarUrlObj = new URL(localVarPath, 'https://example.com');
      let baseOptions;
      if (configuration) {
        baseOptions = configuration.baseOptions;
      }
      const localVarRequestOptions = { method: 'DELETE', ...baseOptions, ...options };
      const localVarHeaderParameter = {} as any;
      const localVarQueryParameter = {} as any;

      const query = new URLSearchParams(localVarUrlObj.search);
      for (const key in localVarQueryParameter) {
        query.set(key, localVarQueryParameter[key]);
      }
      for (const key in options.query) {
        query.set(key, options.query[key]);
      }
      localVarUrlObj.search = new URLSearchParams(query).toString();
      let headersFromBaseOptions = baseOptions && baseOptions.headers ? baseOptions.headers : {};
      localVarRequestOptions.headers = { ...localVarHeaderParameter, ...headersFromBaseOptions, ...options.headers };

      return {
        url: localVarUrlObj.pathname + localVarUrlObj.search + localVarUrlObj.hash,
        options: localVarRequestOptions,
      };
    },
    /**
     * <p align=\"right\">status: <strong>stable</strong></p>
     * @summary Get
     * @param {string} walletId
     * @param {*} [options] Override http request option.
     * @throws {RequiredError}
     */
    getWallet: async (walletId: string, options: any = {}): Promise<RequestArgs> => {
      // verify required parameter 'walletId' is not null or undefined
      if (walletId === null || walletId === undefined) {
        throw new RequiredError(
          'walletId',
          'Required parameter walletId was null or undefined when calling getWallet.',
        );
      }
      const localVarPath = `/single-address-wallets/{walletId}`.replace(
        `{${'walletId'}}`,
        encodeURIComponent(String(walletId)),
      );
      // use dummy base URL string because the URL constructor only accepts absolute URLs.
      const localVarUrlObj = new URL(localVarPath, 'https://example.com');
      let baseOptions;
      if (configuration) {
        baseOptions = configuration.baseOptions;
      }
      const localVarRequestOptions = { method: 'GET', ...baseOptions, ...options };
      const localVarHeaderParameter = {} as any;
      const localVarQueryParameter = {} as any;

      const query = new URLSearchParams(localVarUrlObj.search);
      for (const key in localVarQueryParameter) {
        query.set(key, localVarQueryParameter[key]);
      }
      for (const key in options.query) {
        query.set(key, options.query[key]);
      }
      localVarUrlObj.search = new URLSearchParams(query).toString();
      let headersFromBaseOptions = baseOptions && baseOptions.headers ? baseOptions.headers : {};
      localVarRequestOptions.headers = { ...localVarHeaderParameter, ...headersFromBaseOptions, ...options.headers };

      return {
        url: localVarUrlObj.pathname + localVarUrlObj.search + localVarUrlObj.hash,
        options: localVarRequestOptions,
      };
    },
    /**
     * <p align=\"right\">status: <strong>stable</strong></p>  Return a list of known wallets, ordered from oldest to newest.
     * @summary List
     * @param {*} [options] Override http request option.
     * @throws {RequiredError}
     */
    listWallets: async (options: any = {}): Promise<RequestArgs> => {
      const localVarPath = `/single-address-wallets`;
      // use dummy base URL string because the URL constructor only accepts absolute URLs.
      const localVarUrlObj = new URL(localVarPath, 'https://example.com');
      let baseOptions;
      if (configuration) {
        baseOptions = configuration.baseOptions;
      }
      const localVarRequestOptions = { method: 'GET', ...baseOptions, ...options };
      const localVarHeaderParameter = {} as any;
      const localVarQueryParameter = {} as any;

      const query = new URLSearchParams(localVarUrlObj.search);
      for (const key in localVarQueryParameter) {
        query.set(key, localVarQueryParameter[key]);
      }
      for (const key in options.query) {
        query.set(key, options.query[key]);
      }
      localVarUrlObj.search = new URLSearchParams(query).toString();
      let headersFromBaseOptions = baseOptions && baseOptions.headers ? baseOptions.headers : {};
      localVarRequestOptions.headers = { ...localVarHeaderParameter, ...headersFromBaseOptions, ...options.headers };

      return {
        url: localVarUrlObj.pathname + localVarUrlObj.search + localVarUrlObj.hash,
        options: localVarRequestOptions,
      };
    },
    /**
     * <p align=\"right\">status: <strong>stable</strong></p>  Create and restore a wallet from a mnemonic sentence or account public key.
     * @summary Create / Restore
     * @param {ApiSingleAddressWalletPostData} body
     * @param {*} [options] Override http request option.
     * @throws {RequiredError}
     */
    postWallet: async (body: ApiSingleAddressWalletPostData, options: any = {}): Promise<RequestArgs> => {
      // verify required parameter 'body' is not null or undefined
      if (body === null || body === undefined) {
        throw new RequiredError('body', 'Required parameter body was null or undefined when calling postWallet.');
      }
      const localVarPath = `/single-address-wallets`;
      // use dummy base URL string because the URL constructor only accepts absolute URLs.
      const localVarUrlObj = new URL(localVarPath, 'https://example.com');
      let baseOptions;
      if (configuration) {
        baseOptions = configuration.baseOptions;
      }
      const localVarRequestOptions = { method: 'POST', ...baseOptions, ...options };
      const localVarHeaderParameter = {} as any;
      const localVarQueryParameter = {} as any;

      localVarHeaderParameter['Content-Type'] = 'application/json';

      const query = new URLSearchParams(localVarUrlObj.search);
      for (const key in localVarQueryParameter) {
        query.set(key, localVarQueryParameter[key]);
      }
      for (const key in options.query) {
        query.set(key, options.query[key]);
      }
      localVarUrlObj.search = new URLSearchParams(query).toString();
      let headersFromBaseOptions = baseOptions && baseOptions.headers ? baseOptions.headers : {};
      localVarRequestOptions.headers = { ...localVarHeaderParameter, ...headersFromBaseOptions, ...options.headers };
      const needsSerialization =
        typeof body !== 'string' || localVarRequestOptions.headers['Content-Type'] === 'application/json';
      localVarRequestOptions.data = needsSerialization ? JSON.stringify(body !== undefined ? body : {}) : body || '';

      return {
        url: localVarUrlObj.pathname + localVarUrlObj.search + localVarUrlObj.hash,
        options: localVarRequestOptions,
      };
    },

    // Copied over almost exactly, except the localVarPath
    listTransactions: async (
      walletId: string,
      start?: string,
      end?: string,
      order?: string,
      minWithdrawal?: number,
      options: any = {},
    ): Promise<RequestArgs> => {
      // verify required parameter 'walletId' is not null or undefined
      if (walletId === null || walletId === undefined) {
        throw new RequiredError(
          'walletId',
          'Required parameter walletId was null or undefined when calling listTransactions.',
        );
      }
      const localVarPath = `/single-address-wallets/{walletId}/transactions`.replace(
        `{${'walletId'}}`,
        encodeURIComponent(String(walletId)),
      );
      // use dummy base URL string because the URL constructor only accepts absolute URLs.
      const localVarUrlObj = new URL(localVarPath, 'https://example.com');
      let baseOptions;
      if (configuration) {
        baseOptions = configuration.baseOptions;
      }
      const localVarRequestOptions = { method: 'GET', ...baseOptions, ...options };
      const localVarHeaderParameter = {} as any;
      const localVarQueryParameter = {} as any;

      if (start !== undefined) {
        localVarQueryParameter['start'] = start;
      }

      if (end !== undefined) {
        localVarQueryParameter['end'] = end;
      }

      if (order !== undefined) {
        localVarQueryParameter['order'] = order;
      }

      if (minWithdrawal !== undefined) {
        localVarQueryParameter['minWithdrawal'] = minWithdrawal;
      }

      const query = new URLSearchParams(localVarUrlObj.search);
      for (const key in localVarQueryParameter) {
        query.set(key, localVarQueryParameter[key]);
      }
      for (const key in options.query) {
        query.set(key, options.query[key]);
      }
      localVarUrlObj.search = new URLSearchParams(query).toString();
      let headersFromBaseOptions = baseOptions && baseOptions.headers ? baseOptions.headers : {};
      localVarRequestOptions.headers = { ...localVarHeaderParameter, ...headersFromBaseOptions, ...options.headers };

      return {
        url: localVarUrlObj.pathname + localVarUrlObj.search + localVarUrlObj.hash,
        options: localVarRequestOptions,
      };
    },

    coinSelection: async (
      body: ApiPostTransactionFeeData,
      walletId: string,
      options: any = {},
    ): Promise<RequestArgs> => {
      // verify required parameter 'body' is not null or undefined
      if (body === null || body === undefined) {
        throw new RequiredError('body', 'Required parameter body was null or undefined when calling selectCoins.');
      }
      // verify required parameter 'walletId' is not null or undefined
      if (walletId === null || walletId === undefined) {
        throw new RequiredError(
          'walletId',
          'Required parameter walletId was null or undefined when calling selectCoins.',
        );
      }
      const localVarPath = `/single-address-wallets/{walletId}/coin-selections/random`.replace(
        `{${'walletId'}}`,
        encodeURIComponent(String(walletId)),
      );
      // use dummy base URL string because the URL constructor only accepts absolute URLs.
      const localVarUrlObj = new URL(localVarPath, 'https://example.com');
      let baseOptions;
      if (configuration) {
        baseOptions = configuration.baseOptions;
      }
      const localVarRequestOptions = { method: 'POST', ...baseOptions, ...options };
      const localVarHeaderParameter = {} as any;
      const localVarQueryParameter = {} as any;

      localVarHeaderParameter['Content-Type'] = 'application/json';

      const query = new URLSearchParams(localVarUrlObj.search);
      for (const key in localVarQueryParameter) {
        query.set(key, localVarQueryParameter[key]);
      }
      for (const key in options.query) {
        query.set(key, options.query[key]);
      }
      localVarUrlObj.search = new URLSearchParams(query).toString();
      let headersFromBaseOptions = baseOptions && baseOptions.headers ? baseOptions.headers : {};
      localVarRequestOptions.headers = { ...localVarHeaderParameter, ...headersFromBaseOptions, ...options.headers };
      const needsSerialization =
        typeof body !== 'string' || localVarRequestOptions.headers['Content-Type'] === 'application/json';
      localVarRequestOptions.data = needsSerialization ? JSON.stringify(body !== undefined ? body : {}) : body || '';

      return {
        url: localVarUrlObj.pathname + localVarUrlObj.search + localVarUrlObj.hash,
        options: localVarRequestOptions,
      };
    },
  };
};

/**
 * SingleAddressWalletsApi - functional programming interface
 * @export
 */
export const SingleAddressWalletsApiFp = function (configuration?: Configuration) {
  return {
    /**
     * <p align=\"right\">status: <strong>stable</strong></p>
     * @summary Delete
     * @param {string} walletId
     * @param {*} [options] Override http request option.
     * @throws {RequiredError}
     */
    async deleteWallet(
      walletId: string,
      options?: any,
    ): Promise<(axios?: AxiosInstance, basePath?: string) => AxiosPromise<void>> {
      const localVarAxiosArgs = await SingleAddressWalletsApiAxiosParamCreator(configuration).deleteWallet(
        walletId,
        options,
      );
      return (axios: AxiosInstance = globalAxios, basePath: string = BASE_PATH) => {
        const axiosRequestArgs = { ...localVarAxiosArgs.options, url: basePath + localVarAxiosArgs.url };
        return axios.request(axiosRequestArgs);
      };
    },
    /**
     * <p align=\"right\">status: <strong>stable</strong></p>
     * @summary Get
     * @param {string} walletId
     * @param {*} [options] Override http request option.
     * @throws {RequiredError}
     */
    async getWallet(
      walletId: string,
      options?: any,
    ): Promise<(axios?: AxiosInstance, basePath?: string) => AxiosPromise<ApiSingleAddressWallet>> {
      const localVarAxiosArgs = await SingleAddressWalletsApiAxiosParamCreator(configuration).getWallet(
        walletId,
        options,
      );
      return (axios: AxiosInstance = globalAxios, basePath: string = BASE_PATH) => {
        const axiosRequestArgs = { ...localVarAxiosArgs.options, url: basePath + localVarAxiosArgs.url };
        return axios.request(axiosRequestArgs);
      };
    },
    /**
     * <p align=\"right\">status: <strong>stable</strong></p>  Return a list of known wallets, ordered from oldest to newest.
     * @summary List
     * @param {*} [options] Override http request option.
     * @throws {RequiredError}
     */
    async listWallets(
      options?: any,
    ): Promise<(axios?: AxiosInstance, basePath?: string) => AxiosPromise<Array<ApiSingleAddressWallet>>> {
      const localVarAxiosArgs = await SingleAddressWalletsApiAxiosParamCreator(configuration).listWallets(options);
      return (axios: AxiosInstance = globalAxios, basePath: string = BASE_PATH) => {
        const axiosRequestArgs = { ...localVarAxiosArgs.options, url: basePath + localVarAxiosArgs.url };
        return axios.request(axiosRequestArgs);
      };
    },
    /**
     * <p align=\"right\">status: <strong>stable</strong></p>  Create and restore a wallet from a mnemonic sentence or account public key.
     * @summary Create / Restore
     * @param {ApiSingleAddressWalletPostData} body
     * @param {*} [options] Override http request option.
     * @throws {RequiredError}
     */
    async postWallet(
      body: ApiSingleAddressWalletPostData,
      options?: any,
    ): Promise<(axios?: AxiosInstance, basePath?: string) => AxiosPromise<ApiSingleAddressWallet>> {
      const localVarAxiosArgs = await SingleAddressWalletsApiAxiosParamCreator(configuration).postWallet(body, options);
      return (axios: AxiosInstance = globalAxios, basePath: string = BASE_PATH) => {
        const axiosRequestArgs = { ...localVarAxiosArgs.options, url: basePath + localVarAxiosArgs.url };
        return axios.request(axiosRequestArgs);
      };
    },

    async listTransactions(
      walletId: string,
      start?: string,
      end?: string,
      order?: string,
      minWithdrawal?: number,
      options?: any,
    ): Promise<(axios?: AxiosInstance, basePath?: string) => AxiosPromise<Array<ApiTransaction>>> {
      const localVarAxiosArgs = await SingleAddressWalletsApiAxiosParamCreator(configuration).listTransactions(
        walletId,
        start,
        end,
        order,
        minWithdrawal,
        options,
      );
      return (axios: AxiosInstance = globalAxios, basePath: string = BASE_PATH) => {
        const axiosRequestArgs = { ...localVarAxiosArgs.options, url: basePath + localVarAxiosArgs.url };
        return axios.request(axiosRequestArgs);
      };
    },

    async coinSelection(
      body: ApiPostTransactionFeeData,
      walletId: string,
      options?: any,
    ): Promise<(axios?: AxiosInstance, basePath?: string) => AxiosPromise<ApiCoinSelection>> {
      const localVarAxiosArgs = await SingleAddressWalletsApiAxiosParamCreator(configuration).coinSelection(
        body,
        walletId,
        options,
      );
      return (axios: AxiosInstance = globalAxios, basePath: string = BASE_PATH) => {
        const axiosRequestArgs = { ...localVarAxiosArgs.options, url: basePath + localVarAxiosArgs.url };
        return axios.request(axiosRequestArgs);
      };
    },
  };
};

/**
 * SingleAddressWalletsApi - factory interface
 * @export
 */
export const SingleAddressWalletsApiFactory = function (
  configuration?: Configuration,
  basePath?: string,
  axios?: AxiosInstance,
) {
  return {
    /**
     * <p align=\"right\">status: <strong>stable</strong></p>
     * @summary Delete
     * @param {string} walletId
     * @param {*} [options] Override http request option.
     * @throws {RequiredError}
     */
    deleteWallet(walletId: string, options?: any): AxiosPromise<void> {
      return SingleAddressWalletsApiFp(configuration)
        .deleteWallet(walletId, options)
        .then((request) => request(axios, basePath));
    },
    /**
     * <p align=\"right\">status: <strong>stable</strong></p>
     * @summary Get
     * @param {string} walletId
     * @param {*} [options] Override http request option.
     * @throws {RequiredError}
     */
    getWallet(walletId: string, options?: any): AxiosPromise<ApiSingleAddressWallet> {
      return SingleAddressWalletsApiFp(configuration)
        .getWallet(walletId, options)
        .then((request) => request(axios, basePath));
    },
    /**
     * <p align=\"right\">status: <strong>stable</strong></p>  Return a list of known wallets, ordered from oldest to newest.
     * @summary List
     * @param {*} [options] Override http request option.
     * @throws {RequiredError}
     */
    listWallets(options?: any): AxiosPromise<Array<ApiSingleAddressWallet>> {
      return SingleAddressWalletsApiFp(configuration)
        .listWallets(options)
        .then((request) => request(axios, basePath));
    },
    /**
     * <p align=\"right\">status: <strong>stable</strong></p>  Create and restore a wallet from a mnemonic sentence or account public key.
     * @summary Create / Restore
     * @param {ApiSingleAddressWalletPostData} body
     * @param {*} [options] Override http request option.
     * @throws {RequiredError}
     */
    postWallet(body: ApiSingleAddressWalletPostData, options?: any): AxiosPromise<ApiSingleAddressWallet> {
      return SingleAddressWalletsApiFp(configuration)
        .postWallet(body, options)
        .then((request) => request(axios, basePath));
    },

    listTransactions(walletId: string, options?: any): AxiosPromise<Array<ApiTransaction>> {
      return SingleAddressWalletsApiFp(configuration)
        .listTransactions(walletId, options)
        .then((request) => request(axios, basePath));
    },

    coinSelection(body: ApiPostTransactionFeeData, options?: any): AxiosPromise<ApiCoinSelection> {
      return SingleAddressWalletsApiFp(configuration)
        .coinSelection(body, options)
        .then((request) => request(axios, basePath));
    },
  };
};
