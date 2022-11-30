import { utils } from '@ckb-lumos/base';
import { EthAsset } from '@force-bridge/x/dist/ckb/model/asset';
import { CkbIndexer, Order, ScriptType, SearchKey } from '@force-bridge/x/dist/ckb/tx-helper/indexer';
import { getOwnerTypeHash } from '@force-bridge/x/dist/ckb/tx-helper/multisig/multisig_helper';
import { logger } from '@force-bridge/x/dist/utils/logger';
import CKB from '@nervosnetwork/ckb-sdk-core';
import Web3 from 'web3';
import { AbiItem } from 'web3-utils';

const minERC20ABI = [
  // balanceOf
  {
    constant: true,
    inputs: [{ name: '_owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: 'balance', type: 'uint256' }],
    type: 'function',
  },
  // decimals
  {
    constant: true,
    inputs: [],
    name: 'decimals',
    outputs: [{ name: '', type: 'uint8' }],
    type: 'function',
  },
];

export class BalanceProvider {
  private web3: Web3;
  private ckb: CKB;
  private ckbIndexer: CkbIndexer;
  private ownerTypeHash: string;

  constructor(ethRpcUrl: string, ckbRpcUrl: string, ckbIndexerUrl: string) {
    this.web3 = new Web3(ethRpcUrl);
    this.ckb = new CKB(ckbRpcUrl);
    this.ckbIndexer = new CkbIndexer(ckbRpcUrl, ckbIndexerUrl);
    this.ownerTypeHash = getOwnerTypeHash();
  }

  async ethBalance(address: string): Promise<bigint> {
    const balance = await this.web3.eth.getBalance(address);
    logger.info(`eth_balance name: ETH, address: ${address}, balance: ${balance}`);
    return BigInt(balance);
  }

  async ethErc20Balance(address: string, tokenAddress: string, name: string): Promise<bigint> {
    const TokenContract = new this.web3.eth.Contract(minERC20ABI as AbiItem[], tokenAddress);
    const erc20_amount = await TokenContract.methods.balanceOf(address).call();
    const erc20_balance = erc20_amount.toString();
    logger.info(
      `eth_erc20_balance name: ${name}, address: ${address}, token: ${tokenAddress}, balance: ${erc20_balance}`,
    );
    return BigInt(erc20_balance);
  }

  async ckbSudtBalance(tokenAddress: string, name: string): Promise<bigint> {
    const typescriptLike = new EthAsset(tokenAddress, this.ownerTypeHash).toTypeScript();
    const typescript = {
      code_hash: typescriptLike.codeHash,
      hash_type: typescriptLike.hashType,
      args: typescriptLike.args,
    };
    const searchKey: SearchKey = {
      script: typescript,
      script_type: ScriptType.type,
    };
    const cells = await this.ckbIndexer.getCells(searchKey, (_index, _cell) => ({ stop: false, push: true }), {
      sizeLimit: 0x1000,
      order: Order.asc,
    });
    const balance = cells.map((cell) => utils.readBigUInt128LE(cell.data)).reduce((b, b0) => b + b0, BigInt(0));
    logger.info(
      `ckb get_cells name: ${name} token: ${tokenAddress}, typescript: ${JSON.stringify(
        typescript,
      )}, typescriptHash: ${utils.computeScriptHash(typescript)} cells.length: ${cells.length}, balance: ${balance}`,
    );
    return BigInt(balance);
  }
}
