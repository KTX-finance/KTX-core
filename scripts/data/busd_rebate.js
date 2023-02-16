const path = require("path");
const fs = require("fs");
const { ethers } = require("ethers");
const fetch = require("node-fetch");
const Redis = require("ioredis");

require("dotenv").config();

const RPC_URLS = [
  "https://bsc-testnet.nodereal.io/v1/9459391f32694c11b182c8d4d9cee750",
];

async function contractAt(address, abiPath, walletSigner) {
  const p = path.resolve(abiPath);
  const rawData = fs.readFileSync(p);
  const contractAbi = JSON.parse(rawData);
  const contract = new ethers.Contract(address, contractAbi, walletSigner);
  return contract;
}

async function getAllOrders() {
  let timestamp = 0;
  let query;
  let orders = [];
  while (true) {
    query = `{
      activePositions(
        first: 1000
        where: {status: "active", timestamp_gt: ${timestamp}}
        orderBy: timestamp
      ) {
        size
        id
        entryFundingRate
        collateral
        averagePrice
        status
        timestamp
        indexToken
        collateralToken
        account
        isLong
      }
      }`;
    let fetchResponse = await fetch(
      "https://testsubgraph.ktx.finance/subgraphs/name/ktx",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          query,
        }),
      }
    );
    let newOrders = await fetchResponse.json();
    orders = orders.concat(newOrders.data.activePositions);
    if (newOrders.data.activePositions.length < 1000) {
      break;
    } else {
      timestamp = orders[orders.length - 1].timestamp;
    }
  }
  console.log("total number of orders: ", orders.length);
  return orders;
}

async function main() {
  let RPC_URL = RPC_URLS[0];
  const PRIVATE_KEY =
    "412f86436a35f0fdde2032a3e9d62aba2a911b7ad13e08f9043582d9a63313de";
  const wallet = new ethers.Wallet(PRIVATE_KEY);
  let walletSigner = wallet.connect(
    new ethers.providers.JsonRpcProvider(RPC_URL)
  );
  let busd = await contractAt(
    "0x6993eC95A649310C88a946A94c20B2aBd37251eC",
    "../../node_cron/abis/Token.json",
    walletSigner
  );
  let orders = await getAllOrders();
  let result = {};
  for (let i = 0; i < orders.length; i++) {
    result[orders[i].account] = 0;
  }
  for (let i = 0; i < orders.length; i++) {
    result[orders[i].account] += orders[i].collateral / 10 ** 30;
  }
  for (let i = 0; i < Object.keys(result).length; i++) {
    let key = Object.keys(result)[i];
    let amount = Math.round(result[key] * 1.2);
    await busd.mint(key, ethers.BigNumber.from(10).pow(18).mul(amount));
    console.log(`idx_${i}:${key}:${amount} rebated!`);
  }
  console.log("Rebate success!");
  return;
}

if (require.main === module) {
  main();
}
