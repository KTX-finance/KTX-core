const path = require("path");
const fs = require("fs");
const { ethers } = require("ethers");
const fetch = require("node-fetch");
const schedule = require("node-schedule");
var StatsD = require("hot-shots");

require("dotenv").config();

async function main() {
  var query = `{
    feeStats(first: 1000, orderBy: id, orderDirection: desc, where: {period: daily}) {
        id
        swap
        period
        mint
        margin
        marginAndLiquidation
        liquidation
        burn
      }
      volumeStats(first: 1000, orderBy: id, orderDirection: desc, where: {period: daily}) {
        swap
        period    
        mint
        margin
        liquidation
        id
        burn
      }
      fundingRates(
        first: 1000
        orderBy: timestamp
        orderDirection: desc
        where: {period: daily, token: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1"}
      ) {
        token
        timestamp
        startTimestamp
        startFundingRate
        period
        id
        endFundingRate
        endTimestamp
      }
      }`;

  const fetchResponse = await fetch(
    "https://api.thegraph.com/subgraphs/name/gmx-io/gmx-stats",
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
  let fee = {};
  let volume = {};
  let funding = {};
  let orders = await fetchResponse.json();
  for (let i = 0; i < orders.data.feeStats.length; i++) {
    fee[orders.data.feeStats[i].id] = orders.data.feeStats[i];
  }
  for (let i = 0; i < orders.data.volumeStats.length; i++) {
    volume[orders.data.volumeStats[i].id] = orders.data.volumeStats[i];
  }
  for (let i = 0; i < orders.data.fundingRates.length; i++) {
    funding[orders.data.fundingRates[i].timestamp] =
      orders.data.fundingRates[i];
  }
  let response = [];
  for (let i = 0; i < orders.data.feeStats.length; i++) {
    let id = orders.data.feeStats[i].id;
    let one_row = [];
    one_row.push(id);
    one_row.push(fee[id].mint / 10 ** 30);
    one_row.push(fee[id].burn / 10 ** 30);
    one_row.push(fee[id].swap / 10 ** 30);
    one_row.push(fee[id].margin / 10 ** 30);
    one_row.push(fee[id].liquidation / 10 ** 30);
    one_row.push(volume[id].mint / 10 ** 30);
    one_row.push(volume[id].burn / 10 ** 30);
    one_row.push(volume[id].swap / 10 ** 30);
    one_row.push(volume[id].margin / 10 ** 30);
    one_row.push(volume[id].liquidation / 10 ** 30);
    if (id in funding) {
      one_row.push(funding[id].startFundingRate);
      one_row.push(funding[id].endFundingRate);
    } else {
      one_row.push(0);
      one_row.push(0);
    }
    response.push(one_row.join(","));
    console.log(one_row.join(","));
  }
  console.log(orders.data.feeStats.length);
  console.log(orders.data.volumeStats.length);
  console.log(orders.data.fundingRates.length);
  console.log(response.length);
  //   console.log(response);

  console.log("Success.");
}

if (require.main === module) {
  main();
}
