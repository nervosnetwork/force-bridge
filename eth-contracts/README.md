## Claim Test Token

```bash
cp .env.example .env

# change your private key and RPC_URL

# check your address in specific network
npx hardhat accounts --network bsc_testnet

# fund the address with associated faucet

# claim test token for your account
npx hardhat claimERC20TestToken --account 0x17c4b5CE0605F63732bfd175feCe7aC6b4620FD2 --network bsc_testnet
```
