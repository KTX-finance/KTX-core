require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-etherscan");
require("hardhat-contract-sizer");
require("@typechain/hardhat");

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async () => {
  const accounts = await ethers.getSigners();

  for (const account of accounts) {
    console.info(account.address);
  }
});

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

// https://data-seed-prebsc-1-s1.binance.org:8545/
// https://data-seed-prebsc-2-s1.binance.org:8545/
// http://data-seed-prebsc-1-s2.binance.org:8545/
// http://data-seed-prebsc-2-s2.binance.org:8545/
// https://data-seed-prebsc-1-s3.binance.org:8545/
// https://data-seed-prebsc-2-s3.binance.org:8545/

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true,
    },
    bsctestnet: {
      url: "https://bsc-testnet.nodereal.io/v1/9459391f32694c11b182c8d4d9cee750",
      chainId: 97,
      gas: "auto",
      // gas: 600000,
      // accounts: [
      // "18a288e26a24a0fcfc741bcbf2c4b4cc57b710c76b37574b68fa1b0b3eef4615",
      // "3d03eba4060f78b1eacd12b764ec95d7525bbf38db575209c3ccbb2a9dc90ead",
      // ],
      accounts: {
        mnemonic:
          "daughter lyrics tooth napkin walnut panic fancy roof endorse assist edge chief",
      },
    },
    hinttestnet: {
      url: "http://13.215.152.254:8545",
      chainId: 9001,
      gas: "auto",
      // gas: 600000,
      // accounts: [
      // "18a288e26a24a0fcfc741bcbf2c4b4cc57b710c76b37574b68fa1b0b3eef4615",
      // "3d03eba4060f78b1eacd12b764ec95d7525bbf38db575209c3ccbb2a9dc90ead",
      // ],
      accounts: {
        mnemonic:
          "daughter lyrics tooth napkin walnut panic fancy roof endorse assist edge chief",
      },
    },
    makalu: {
      url: "https://testnet-rpc.maplabs.io",
      chainId: 212,
      gas: "auto",
      accounts: {
        mnemonic:
          "daughter lyrics tooth napkin walnut panic fancy roof endorse assist edge chief",
      },
    },
  },
  etherscan: {
    apiKey: {
      bsc: "5Z2P4WBGRU5XG9WDB36V6BXSYBRAJTJK5Z",
    },
  },
  solidity: {
    version: "0.6.12",
    settings: {
      optimizer: {
        enabled: true,
        runs: 1,
      },
    },
  },
  typechain: {
    outDir: "typechain",
    target: "ethers-v5",
  },
};
