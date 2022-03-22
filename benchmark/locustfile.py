import json
from locust import FastHttpUser, between, tag, task
import toml


def payload_template(method, param):
    payload = {
        "jsonrpc": "2.0",
        "id": "0",
        "method": method,
        "params": param,
    }

    return payload


class V1(FastHttpUser):
    wait_time = between(1, 5)
    uri = '/force-bridge/api/v1'
    config: dict

    def load_config(self):
        self.config = toml.load('config.toml')

    def on_start(self):
        self.load_config()

        return super().on_start()

    @tag('ckb2eth_lock')
    @task
    def lock_nervos_token(self):
        payload = {
            "assetIdent": self.config["ckb"]["ckb_typescript_hash"],
            "amount": "100000",
            "xchain": "Ethereum",
            "recipient": self.config["ckb"]["lockscript"],
            "sender": self.config["eth"]["address"],
        }

        self.client.post(self.uri, json=payload_template(
            "generateBridgeNervosToXchainLockTx",
            payload
        ))

    @tag('ckb2eth_burn')
    @task
    def burn_nervos_mirror_token_in_eth(self):
        payload = {
            "asset": self.config["eth"]["ckb_mirror_address"],
            "amount": "6100000000",
            "xchain": "Ethereum",
            "recipient": self.config["eth"]["address"],
            "sender": self.config["ckb"]["lockscript"],
        }

        self.client.post(self.uri, json=payload_template(
            "generateBridgeNervosToXchainBurnTx",
            payload,
        ))

    @ tag('eth2ckb_burn')
    @ task
    def burn_eth_mirror_token_in_nervos(self):
        payload = {
            "network": "Ethereum",
            "asset": self.config["eth"]["eth_token_address"],
            "amount": "10000000000000",
            "recipient": self.config["ckb"]["lockscript"],
            "sender": self.config["eth"]["address"],
        }

        self.client.post(self.uri, json=payload_template(
            "generateBridgeOutNervosTransaction",
            payload,
        ))

    @tag('eth2ckb_lock')
    @task
    def lock_eth_token(self):
        payload = {
            "sender": self.config["eth"]["address"],
            "recipient": self.config["ckb"]["lockscript"],
            "asset": {
                "network": "Ethereum",
                "ident": self.config["eth"]["eth_token_address"],
                "amount": "100000000000000"
            }
        }

        self.client.post(self.uri, json=payload_template(
            "generateBridgeInNervosTransaction",
            payload,
        ))

    @ tag('get_minimal_amount')
    @ task
    def get_minimal_amount(self):
        payload = {
            "network": "Ethereum",
            "xchainAssetIdent": self.config["eth"]["eth_token_address"],
            "targetChain": "Nervos",
        }

        self.client.post(self.uri, json=payload_template(
            "getMinimalBridgeAmount",
            payload,
        ))

    @ tag('eth2ckb_lock_bridge_fee')
    @ task
    def bridge_fee_of_lock_eth_token(self):
        payload = {
            "network": "Ethereum",
            "xchainAssetIdent": self.config["eth"]["eth_token_address"],
            "amount": "1000000000",
        }

        self.client.post(self.uri, json=payload_template(
            "getBridgeInNervosBridgeFee",
            payload,
        ))

    @ tag('eth2ckb_burn_bridge_fee')
    @ task
    def bridge_fee_of_burn_eth_mirror_token_in_nervos(self):
        payload = {
            "network": "Ethereum",
            "xchainAssetIdent": self.config["eth"]["eth_token_address"],
            "amount": "20000000000",
        }

        self.client.post(self.uri, json=payload_template(
            "getBridgeOutNervosBridgeFee",
            payload,
        ))

    @ tag('ckb2eth_lock_bridge_fee')
    @ task
    def bridge_fee_of_lock_nervos_token(self):
        payload = {
            "xchain": "Ethereum",
            "typescriptHash": self.config["ckb"]["ckb_typescript_hash"],
            "amount": "6100000000",
        }

        self.client.post(self.uri, payload_template(
            "getBridgeNervosToXchainLockBridgeFee",
            payload,
        ))

    @ tag('ckb2eth_burn_bridge_fee')
    @ task
    def bridge_fee_of_burn_nervos_mirror_token_in_eth(self):
        payload = {
            "xchain": "Ethereum",
            "typescriptHash": self.config["ckb"]["ckb_typescript_hash"],
            "amount": "6100000000",
        }

        self.client.post(self.uri, json=payload_template(
            "getBridgeNervosToXchainLockBridgeFee", payload
        ))

    @ tag('transaction_summaries')
    @ task
    def transaction_summaries(self):
        payload = {
            "network": "Ethereum",
            "xchainAssetIdent": self.config["eth"]["eth_token_address"],
            "user": {
                "network": "Nervos",
                "ident": self.config["ckb"]["lockscript"],
            },
        }

        self.client.post(self.uri, json=payload_template(
            "getBridgeTransactionSummaries",
            payload,
        ))

    @ tag('balance')
    @ task
    def balance(self):
        payload = [
            {
                "network": "Ethereum",
                "userIdent":  self.config["ckb"]["lockscript"],
                "assetIdent": self.config["ckb"]["ckb_typescript_hash"],
            },
        ]

        self.client.post(self.uri, json=payload_template(
            "getBalance",
            payload
        ))

    @ tag('asset_list')
    @ task
    def asset_list(self):
        self.client.post(self.uri, json=payload_template("getAssetList", ""))

    @ tag('config')
    @ task
    def config(self):
        self.client.post(
            self.uri, json=payload_template("getBridgeConfig", {}))
