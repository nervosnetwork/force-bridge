/* tslint:disable */
/* eslint-disable */
/**
   Manually written, ref ApiWallet
 */

import { WalletsAssets, WalletsBalance, WalletsDelegation, WalletsPassphrase, WalletsState, WalletsTip } from "cardano-wallet-js";

/**
 * 
 * @export
 * @interface ApiSingleAddressWallet
 */
export interface ApiSingleAddressWallet {
    /**
     * A unique identifier for the wallet
     * @type {string}
     * @memberof ApiSingleAddressWallet
     */
    id: any;
    /**
     * 
     * @type {WalletsBalance}
     * @memberof ApiSingleAddressWallet
     */
    balance: WalletsBalance;
    /**
     * 
     * @type {WalletsAssets}
     * @memberof ApiSingleAddressWallet
     */
    assets: WalletsAssets;
    /**
     * 
     * @type {string}
     * @memberof ApiSingleAddressWallet
     */
    name: any;
    /**
     * 
     * @type {WalletsState}
     * @memberof ApiSingleAddressWallet
     */
    state: WalletsState;
    /**
     * 
     * @type {WalletsTip}
     * @memberof ApiSingleAddressWallet
     */
    tip: WalletsTip;
}
