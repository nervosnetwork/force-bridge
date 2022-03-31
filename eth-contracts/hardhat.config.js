require('@nomiclabs/hardhat-waffle');
require('solidity-coverage');

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task('accounts', 'Prints the list of accounts', async () => {
  const accounts = await ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
});

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: {
    compilers: [
      {
        version: '0.8.0',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200
          }
        }
      }
    ]
  },

  defaultNetwork: 'hardhat',

  networks: {
    hardhat: {},
    bsc_testnet: {
      network_id: 97,
      url: `https://data-seed-prebsc-1-s1.binance.org:8545`,
    },
    geth: {
      url: `http://127.0.0.1:8545`,
      // address [`0x17c4b5CE0605F63732bfd175feCe7aC6b4620FD2`, `0x46beaC96B726a51C5703f99eC787ce12793Dae11`]
      // Mnemonic [`dignity vehicle fuel siren cool machine video spice oppose olympic polar discover`, ``]
      accounts: [
        'c4ad657963930fbff2e9de3404b30a4e21432c89952ed430b56bf802945ed37a',
        '719e94ec5d2ecef67b5878503ffd6e1e0e2fe7a52ddd55c436878cb4d52d376d',
        '627ed509aa9ef55858d01453c62f44287f639a4fa5a444af150f333b6010a3b6',
        '49e7074797d83cbb93b23877f99a8cecd6f79181f1236f095671017b2edc64c2',
        '6e51216cbb2fe170368da49e82b22f02b999204730c858482d0e84a9083005ac',
        'ca2e37b4f2e4a122cc86c401e3d1da3841c525f01b5b249dcdcd69e2f086d576'
      ]
    }
  },

  mocha: {
    timeout: 30000
  }
};
