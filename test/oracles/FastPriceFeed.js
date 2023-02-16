const { expect, use } = require("chai");
const { solidity } = require("ethereum-waffle");
const { deployContract } = require("../shared/fixtures");
const {
  expandDecimals,
  bigNumberify,
  getBlockTime,
  increaseTime,
  mineBlock,
  reportGasUsed,
  newWallet,
  getPriceBitArray,
  getPriceBits,
} = require("../shared/utilities");
const { toChainlinkPrice } = require("../shared/chainlink");
const { toUsd, toNormalizedPrice } = require("../shared/units");

use(solidity);

function getExpandedPrice(price, precision) {
  return bigNumberify(price).mul(expandDecimals(1, 30)).div(precision);
}

describe("FastPriceFeed", function () {
  const provider = waffle.provider;
  const { AddressZero } = ethers.constants;
  const depositFee = 50;
  const minExecutionFee = 4000;

  const [
    wallet,
    tokenManager,
    mintReceiver,
    user0,
    user1,
    user2,
    user3,
    signer0,
    signer1,
    updater0,
    updater1,
  ] = provider.getWallets();
  let bnb;
  let btc;
  let eth;
  let fastPriceEvents;
  let fastPriceFeed;

  beforeEach(async () => {
    bnb = await deployContract("Token", []);
    btc = await deployContract("Token", []);
    eth = await deployContract("Token", []);

    vault = await deployContract("Vault", []);
    timelock = await deployContract("Timelock", [
      wallet.address,
      5 * 24 * 60 * 60,
      tokenManager.address,
      AddressZero,
      tokenManager.address,
      mintReceiver.address,
      AddressZero,
      expandDecimals(1000, 18),
      10, // marginFeeBasisPoints 0.1%
      500, // maxMarginFeeBasisPoints 5%
    ]);

    usdg = await deployContract("USDG", [vault.address]);
    router = await deployContract("Router", [
      vault.address,
      usdg.address,
      bnb.address,
    ]);
    positionRouter = await deployContract("PositionRouter", [
      vault.address,
      router.address,
      bnb.address,
      depositFee,
      minExecutionFee,
    ]);

    fastPriceEvents = await deployContract("FastPriceEvents", []);
    fastPriceFeed = await deployContract("FastPriceFeed", [
      5 * 60, // _priceDuration
      2, // _minBlockInterval
      250, // _maxDeviationBasisPoints
      fastPriceEvents.address, // _fastPriceEvents
      tokenManager.address, // _tokenManager
      positionRouter.address, // _positionRouter
    ]);
    await fastPriceFeed.initialize(
      2,
      [signer0.address, signer1.address],
      [updater0.address, updater1.address]
    );
    await fastPriceEvents.setIsPriceFeed(fastPriceFeed.address, true);

    await vault.setGov(timelock.address);
  });

  it("inits", async () => {
    expect(await fastPriceFeed.gov()).eq(wallet.address);
    expect(await fastPriceFeed.priceDuration()).eq(5 * 60);
    expect(await fastPriceFeed.minBlockInterval()).eq(2);
    expect(await fastPriceFeed.maxDeviationBasisPoints()).eq(250);
    expect(await fastPriceFeed.fastPriceEvents()).eq(fastPriceEvents.address);
    expect(await fastPriceFeed.tokenManager()).eq(tokenManager.address);
    expect(await fastPriceFeed.positionRouter()).eq(positionRouter.address);
    expect(await fastPriceFeed.minAuthorizations()).eq(2);
    expect(await fastPriceFeed.isSigner(wallet.address)).eq(false);
    expect(await fastPriceFeed.isSigner(signer0.address)).eq(true);
    expect(await fastPriceFeed.isSigner(signer1.address)).eq(true);

    expect(await fastPriceFeed.isUpdater(wallet.address)).eq(false);
    expect(await fastPriceFeed.isUpdater(updater0.address)).eq(true);
    expect(await fastPriceFeed.isUpdater(updater1.address)).eq(true);

    await expect(
      fastPriceFeed.initialize(
        2,
        [signer0.address, signer1.address],
        [updater0.address, updater1.address]
      )
    ).to.be.revertedWith("FastPriceFeed: already initialized");
  });

  it("setTokenManager", async () => {
    await expect(
      fastPriceFeed.connect(user0).setTokenManager(user1.address)
    ).to.be.revertedWith("Governable: forbidden");

    await fastPriceFeed.setGov(user0.address);

    expect(await fastPriceFeed.tokenManager()).eq(tokenManager.address);
    await fastPriceFeed.connect(user0).setTokenManager(user1.address);
    expect(await fastPriceFeed.tokenManager()).eq(user1.address);
  });

  it("setSigner", async () => {
    await expect(
      fastPriceFeed.connect(user0).setSigner(user1.address, true)
    ).to.be.revertedWith("Governable: forbidden");

    await fastPriceFeed.setGov(user0.address);

    expect(await fastPriceFeed.isSigner(user1.address)).eq(false);
    await fastPriceFeed.connect(user0).setSigner(user1.address, true);
    expect(await fastPriceFeed.isSigner(user1.address)).eq(true);
  });

  it("setUpdater", async () => {
    await expect(
      fastPriceFeed.connect(user0).setUpdater(user1.address, true)
    ).to.be.revertedWith("Governable: forbidden");

    await fastPriceFeed.setGov(user0.address);

    expect(await fastPriceFeed.isUpdater(user1.address)).eq(false);
    await fastPriceFeed.connect(user0).setUpdater(user1.address, true);
    expect(await fastPriceFeed.isUpdater(user1.address)).eq(true);
  });

  it("setFastPriceEvents", async () => {
    await expect(
      fastPriceFeed.connect(user0).setFastPriceEvents(user1.address)
    ).to.be.revertedWith("Governable: forbidden");

    await fastPriceFeed.setGov(user0.address);

    expect(await fastPriceFeed.fastPriceEvents()).eq(fastPriceEvents.address);
    await fastPriceFeed.connect(user0).setFastPriceEvents(user1.address);
    expect(await fastPriceFeed.fastPriceEvents()).eq(user1.address);
  });

  it("setPriceDuration", async () => {
    await expect(
      fastPriceFeed.connect(user0).setPriceDuration(30 * 60)
    ).to.be.revertedWith("Governable: forbidden");

    await fastPriceFeed.setGov(user0.address);

    await expect(
      fastPriceFeed.connect(user0).setPriceDuration(31 * 60)
    ).to.be.revertedWith("FastPriceFeed: invalid _priceDuration");

    expect(await fastPriceFeed.priceDuration()).eq(5 * 60);
    await fastPriceFeed.connect(user0).setPriceDuration(30 * 60);
    expect(await fastPriceFeed.priceDuration()).eq(30 * 60);
  });

  it("setMinBlockInterval", async () => {
    await expect(
      fastPriceFeed.connect(user0).setMinBlockInterval(10)
    ).to.be.revertedWith("Governable: forbidden");

    await fastPriceFeed.setGov(user0.address);

    expect(await fastPriceFeed.minBlockInterval()).eq(2);
    await fastPriceFeed.connect(user0).setMinBlockInterval(10);
    expect(await fastPriceFeed.minBlockInterval()).eq(10);
  });

  it("setIsSpreadEnabled", async () => {
    await expect(
      fastPriceFeed.connect(user0).setIsSpreadEnabled(true)
    ).to.be.revertedWith("Governable: forbidden");

    await fastPriceFeed.setGov(user0.address);

    expect(await fastPriceFeed.isSpreadEnabled()).eq(false);
    expect(await fastPriceFeed.favorFastPrice()).eq(true);
    await fastPriceFeed.connect(user0).setIsSpreadEnabled(true);
    expect(await fastPriceFeed.isSpreadEnabled()).eq(true);
    expect(await fastPriceFeed.favorFastPrice()).eq(false);
  });

  it("setMaxTimeDeviation", async () => {
    await expect(
      fastPriceFeed.connect(user0).setMaxTimeDeviation(1000)
    ).to.be.revertedWith("Governable: forbidden");

    await fastPriceFeed.setGov(user0.address);

    expect(await fastPriceFeed.maxTimeDeviation()).eq(0);
    await fastPriceFeed.connect(user0).setMaxTimeDeviation(1000);
    expect(await fastPriceFeed.maxTimeDeviation()).eq(1000);
  });

  it("setLastUpdatedAt", async () => {
    await expect(
      fastPriceFeed.connect(user0).setLastUpdatedAt(700)
    ).to.be.revertedWith("Governable: forbidden");

    await fastPriceFeed.setGov(user0.address);

    expect(await fastPriceFeed.lastUpdatedAt()).eq(0);
    await fastPriceFeed.connect(user0).setLastUpdatedAt(700);
    expect(await fastPriceFeed.lastUpdatedAt()).eq(700);
  });

  it("setVolBasisPoints", async () => {
    await expect(
      fastPriceFeed.connect(user0).setVolBasisPoints(20)
    ).to.be.revertedWith("Governable: forbidden");

    await fastPriceFeed.setGov(user0.address);

    expect(await fastPriceFeed.volBasisPoints()).eq(0);
    await fastPriceFeed.connect(user0).setVolBasisPoints(20);
    expect(await fastPriceFeed.volBasisPoints()).eq(20);
  });

  it("setMaxDeviationBasisPoints", async () => {
    await expect(
      fastPriceFeed.connect(user0).setMaxDeviationBasisPoints(100)
    ).to.be.revertedWith("Governable: forbidden");

    await fastPriceFeed.setGov(user0.address);

    expect(await fastPriceFeed.maxDeviationBasisPoints()).eq(250);
    await fastPriceFeed.connect(user0).setMaxDeviationBasisPoints(100);
    expect(await fastPriceFeed.maxDeviationBasisPoints()).eq(100);
  });

  it("setMinAuthorizations", async () => {
    await expect(
      fastPriceFeed.connect(user0).setMinAuthorizations(3)
    ).to.be.revertedWith("FastPriceFeed: forbidden");

    await fastPriceFeed.setTokenManager(user0.address);

    expect(await fastPriceFeed.minAuthorizations()).eq(2);
    await fastPriceFeed.connect(user0).setMinAuthorizations(3);
    expect(await fastPriceFeed.minAuthorizations()).eq(3);
  });

  it("setPrices", async () => {
    let blockTime = await getBlockTime(provider);
    await expect(
      fastPriceFeed
        .connect(wallet)
        .setPrices(
          [btc.address, eth.address, bnb.address],
          [
            expandDecimals(60000, 30),
            expandDecimals(5000, 30),
            expandDecimals(700, 30),
          ],
          blockTime + 100
        )
    ).to.be.revertedWith("FastPriceFeed: forbidden");

    expect(await fastPriceFeed.lastUpdatedAt()).eq(0);
    expect(await fastPriceFeed.lastUpdatedBlock()).eq(0);

    await expect(
      fastPriceFeed
        .connect(updater0)
        .setPrices(
          [btc.address, eth.address, bnb.address],
          [
            expandDecimals(60000, 30),
            expandDecimals(5000, 30),
            expandDecimals(700, 30),
          ],
          blockTime + 100
        )
    ).to.be.revertedWith("FastPriceFeed: _timestamp exceeds allowed range");

    await fastPriceFeed.setMaxTimeDeviation(200);

    await fastPriceFeed
      .connect(updater0)
      .setPrices(
        [btc.address, eth.address, bnb.address],
        [
          expandDecimals(60000, 30),
          expandDecimals(5000, 30),
          expandDecimals(700, 30),
        ],
        blockTime + 100
      );
    const blockNumber0 = await provider.getBlockNumber();
    expect(await fastPriceFeed.lastUpdatedBlock()).eq(blockNumber0);

    expect(await fastPriceFeed.prices(btc.address)).eq(
      expandDecimals(60000, 30)
    );
    expect(await fastPriceFeed.prices(eth.address)).eq(
      expandDecimals(5000, 30)
    );
    expect(await fastPriceFeed.prices(bnb.address)).eq(expandDecimals(700, 30));

    expect(await fastPriceFeed.lastUpdatedAt()).eq(blockTime + 100);

    await expect(
      fastPriceFeed
        .connect(updater0)
        .setPrices(
          [btc.address, eth.address, bnb.address],
          [
            expandDecimals(60000, 30),
            expandDecimals(5000, 30),
            expandDecimals(700, 30),
          ],
          blockTime + 100
        )
    ).to.be.revertedWith("FastPriceFeed: minBlockInterval not yet passed");
    const blockNumber1 = await provider.getBlockNumber();
    expect(blockNumber1 - blockNumber0).eq(1);
    await mineBlock(provider);

    await fastPriceFeed
      .connect(updater1)
      .setPrices(
        [btc.address, eth.address, bnb.address],
        [
          expandDecimals(60000, 30),
          expandDecimals(5000, 30),
          expandDecimals(700, 30),
        ],
        blockTime + 100
      );
    expect(await fastPriceFeed.lastUpdatedBlock()).eq(blockNumber0 + 3);
  });

  it("favorFastPrice", async () => {
    await expect(
      fastPriceFeed.connect(user0).disableFastPrice()
    ).to.be.revertedWith("FastPriceFeed: forbidden");
    await expect(
      fastPriceFeed.connect(user1).disableFastPrice()
    ).to.be.revertedWith("FastPriceFeed: forbidden");

    expect(await fastPriceFeed.favorFastPrice()).eq(true);
    expect(await fastPriceFeed.disableFastPriceVotes(signer0.address)).eq(
      false
    );
    expect(await fastPriceFeed.disableFastPriceVoteCount()).eq(0);

    await fastPriceFeed.connect(signer0).disableFastPrice();

    expect(await fastPriceFeed.favorFastPrice()).eq(true);
    expect(await fastPriceFeed.disableFastPriceVotes(signer0.address)).eq(true);
    expect(await fastPriceFeed.disableFastPriceVoteCount()).eq(1);

    await expect(
      fastPriceFeed.connect(signer0).disableFastPrice()
    ).to.be.revertedWith("FastPriceFeed: already voted");

    expect(await fastPriceFeed.favorFastPrice()).eq(true);
    expect(await fastPriceFeed.disableFastPriceVotes(signer1.address)).eq(
      false
    );
    expect(await fastPriceFeed.disableFastPriceVoteCount()).eq(1);

    await fastPriceFeed.connect(signer1).disableFastPrice();

    expect(await fastPriceFeed.favorFastPrice()).eq(false);
    expect(await fastPriceFeed.disableFastPriceVotes(signer1.address)).eq(true);
    expect(await fastPriceFeed.disableFastPriceVoteCount()).eq(2);

    await expect(
      fastPriceFeed.connect(user1).enableFastPrice()
    ).to.be.revertedWith("FastPriceFeed: forbidden");

    await fastPriceFeed.connect(signer1).enableFastPrice();

    expect(await fastPriceFeed.favorFastPrice()).eq(true);
    expect(await fastPriceFeed.disableFastPriceVotes(signer1.address)).eq(
      false
    );
    expect(await fastPriceFeed.disableFastPriceVoteCount()).eq(1);

    await expect(
      fastPriceFeed.connect(signer1).enableFastPrice()
    ).to.be.revertedWith("FastPriceFeed: already enabled");
  });

  it("getPrice", async () => {
    let blockTime = await getBlockTime(provider);
    await fastPriceFeed.setMaxTimeDeviation(1000);

    expect(await fastPriceFeed.getPrice(bnb.address, 800, true)).eq(800);
    await fastPriceFeed
      .connect(updater0)
      .setPrices([bnb.address], [801], blockTime);
    expect(await fastPriceFeed.getPrice(bnb.address, 800, true)).eq(801);

    await mineBlock(provider);
    await fastPriceFeed
      .connect(updater0)
      .setPrices([bnb.address], [900], blockTime);
    expect(await fastPriceFeed.getPrice(bnb.address, 800, true)).eq(820);
    expect(await fastPriceFeed.getPrice(bnb.address, 800, false)).eq(800);

    await mineBlock(provider);
    await fastPriceFeed
      .connect(updater0)
      .setPrices([bnb.address], [700], blockTime);
    expect(await fastPriceFeed.getPrice(bnb.address, 800, true)).eq(800);
    expect(await fastPriceFeed.getPrice(bnb.address, 800, false)).eq(780);

    await mineBlock(provider);
    await fastPriceFeed
      .connect(updater1)
      .setPrices([bnb.address], [900], blockTime);

    await increaseTime(provider, 200);
    await mineBlock(provider);

    expect(await fastPriceFeed.getPrice(bnb.address, 800, true)).eq(820);

    await increaseTime(provider, 110);
    await mineBlock(provider);

    expect(await fastPriceFeed.getPrice(bnb.address, 800, true)).eq(800);

    await mineBlock(provider);
    await fastPriceFeed
      .connect(updater1)
      .setPrices([bnb.address], [810], blockTime);

    expect(await fastPriceFeed.getPrice(bnb.address, 800, true)).eq(800);

    blockTime = blockTime + 500;

    await mineBlock(provider);
    await fastPriceFeed
      .connect(updater1)
      .setPrices([bnb.address], [810], blockTime);

    expect(await fastPriceFeed.getPrice(bnb.address, 800, true)).eq(810);
    expect(await fastPriceFeed.getPrice(bnb.address, 800, false)).eq(810);

    await mineBlock(provider);
    await fastPriceFeed
      .connect(updater1)
      .setPrices([bnb.address], [790], blockTime);
    expect(await fastPriceFeed.getPrice(bnb.address, 800, true)).eq(790);
    expect(await fastPriceFeed.getPrice(bnb.address, 800, false)).eq(790);

    await fastPriceFeed.setVolBasisPoints(20);

    await mineBlock(provider);
    await fastPriceFeed
      .connect(updater1)
      .setPrices([bnb.address], [810], blockTime);
    expect(await fastPriceFeed.getPrice(bnb.address, 800, true)).eq(810);
    expect(await fastPriceFeed.getPrice(bnb.address, 800, false)).eq(808); // 810 * (100 - 0.2)%

    await mineBlock(provider);
    await fastPriceFeed
      .connect(updater1)
      .setPrices([bnb.address], [790], blockTime);
    expect(await fastPriceFeed.getPrice(bnb.address, 800, true)).eq(791); // 790 * (100 + 0.2)%
    expect(await fastPriceFeed.getPrice(bnb.address, 800, false)).eq(790);

    await fastPriceFeed.connect(signer0).disableFastPrice();
    await fastPriceFeed.connect(signer1).disableFastPrice();

    await mineBlock(provider);
    await fastPriceFeed
      .connect(updater1)
      .setPrices([bnb.address], [810], blockTime);
    expect(await fastPriceFeed.getPrice(bnb.address, 800, true)).eq(810);
    expect(await fastPriceFeed.getPrice(bnb.address, 800, false)).eq(800);

    await mineBlock(provider);
    await fastPriceFeed
      .connect(updater1)
      .setPrices([bnb.address], [790], blockTime);
    expect(await fastPriceFeed.getPrice(bnb.address, 800, true)).eq(800);
    expect(await fastPriceFeed.getPrice(bnb.address, 800, false)).eq(790);
  });

  it("setTokens", async () => {
    const token1 = await deployContract("Token", []);
    const token2 = await deployContract("Token", []);

    await expect(
      fastPriceFeed
        .connect(user0)
        .setTokens([token1.address, token2.address], [100, 1000])
    ).to.be.revertedWith("Governable: forbidden");

    await fastPriceFeed.setGov(user0.address);

    await expect(
      fastPriceFeed
        .connect(user0)
        .setTokens([token1.address, token2.address], [100])
    ).to.be.revertedWith("FastPriceFeed: invalid lengths");

    await fastPriceFeed
      .connect(user0)
      .setTokens([token1.address, token2.address], [100, 1000]);

    expect(await fastPriceFeed.tokens(0)).eq(token1.address);
    expect(await fastPriceFeed.tokens(1)).eq(token2.address);
    expect(await fastPriceFeed.tokenPrecisions(0)).eq(100);
    expect(await fastPriceFeed.tokenPrecisions(1)).eq(1000);
  });

  it("setCompactedPrices", async () => {
    const price1 = "2009991111";
    const price2 = "1004445555";
    const price3 = "123";
    const price4 = "4567";
    const price5 = "891011";
    const price6 = "1213141516";
    const price7 = "234";
    const price8 = "5678";
    const price9 = "910910";
    const price10 = "10";

    const token1 = await deployContract("Token", []);
    const token2 = await deployContract("Token", []);
    const token3 = await deployContract("Token", []);
    const token4 = await deployContract("Token", []);
    const token5 = await deployContract("Token", []);
    const token6 = await deployContract("Token", []);
    const token7 = await deployContract("Token", []);
    const token8 = await deployContract("Token", []);
    const token9 = await deployContract("Token", []);
    const token10 = await deployContract("Token", []);

    await fastPriceFeed
      .connect(wallet)
      .setTokens([token1.address, token2.address], [1000, 1000]);
    await fastPriceFeed.setMaxTimeDeviation(1000);

    let priceBitArray = getPriceBitArray([price1, price2]);
    let blockTime = await getBlockTime(provider);

    expect(priceBitArray.length).eq(1);

    await expect(
      fastPriceFeed.connect(user0).setCompactedPrices(priceBitArray, blockTime)
    ).to.be.revertedWith("FastPriceFeed: forbidden");

    await fastPriceFeed.connect(wallet).setUpdater(user0.address, true);

    expect(await fastPriceFeed.lastUpdatedAt()).eq(0);

    await fastPriceFeed
      .connect(user0)
      .setCompactedPrices(priceBitArray, blockTime);

    expect(await fastPriceFeed.prices(token1.address)).eq(
      getExpandedPrice(price1, 1000)
    );
    expect(await fastPriceFeed.prices(token2.address)).eq(
      getExpandedPrice(price2, 1000)
    );

    expect(await fastPriceFeed.lastUpdatedAt()).eq(blockTime);

    await fastPriceFeed
      .connect(wallet)
      .setTokens([token1.address, token2.address], [1000, 10000]);

    blockTime = blockTime + 500;

    await fastPriceFeed
      .connect(user0)
      .setCompactedPrices(priceBitArray, blockTime);

    expect(await fastPriceFeed.prices(token1.address)).eq(
      getExpandedPrice(price1, 1000)
    );
    expect(await fastPriceFeed.prices(token2.address)).eq(
      getExpandedPrice(price2, 10000)
    );

    expect(await fastPriceFeed.lastUpdatedAt()).eq(blockTime);

    await fastPriceFeed
      .connect(wallet)
      .setTokens(
        [
          token1.address,
          token2.address,
          token3.address,
          token4.address,
          token5.address,
          token6.address,
          token7.address,
        ],
        [1000, 100, 10, 1000, 10000, 1000, 1000]
      );

    priceBitArray = getPriceBitArray([
      price1,
      price2,
      price3,
      price4,
      price5,
      price6,
      price7,
    ]);

    expect(priceBitArray.length).eq(1);

    await fastPriceFeed
      .connect(user0)
      .setCompactedPrices(priceBitArray, blockTime);

    const p1 = await fastPriceFeed.prices(token1.address);
    expect(ethers.utils.formatUnits(p1, 30)).eq("2009991.111");
    expect(await fastPriceFeed.prices(token1.address)).eq(
      "2009991111000000000000000000000000000"
    );
    expect(await fastPriceFeed.prices(token2.address)).eq(
      getExpandedPrice(price2, 100)
    );
    expect(await fastPriceFeed.prices(token3.address)).eq(
      getExpandedPrice(price3, 10)
    );
    expect(await fastPriceFeed.prices(token4.address)).eq(
      getExpandedPrice(price4, 1000)
    );
    expect(await fastPriceFeed.prices(token5.address)).eq(
      getExpandedPrice(price5, 10000)
    );
    expect(await fastPriceFeed.prices(token6.address)).eq(
      getExpandedPrice(price6, 1000)
    );
    expect(await fastPriceFeed.prices(token7.address)).eq(
      getExpandedPrice(price7, 1000)
    );

    await fastPriceFeed
      .connect(wallet)
      .setTokens(
        [
          token1.address,
          token2.address,
          token3.address,
          token4.address,
          token5.address,
          token6.address,
          token7.address,
          token8.address,
        ],
        [1000, 100, 10, 1000, 10000, 1000, 1000, 100]
      );

    priceBitArray = getPriceBitArray([
      price1,
      price2,
      price3,
      price4,
      price5,
      price6,
      price7,
      price8,
    ]);

    expect(priceBitArray.length).eq(1);

    await fastPriceFeed
      .connect(user0)
      .setCompactedPrices(priceBitArray, blockTime);

    expect(await fastPriceFeed.prices(token1.address)).eq(
      getExpandedPrice(price1, 1000)
    );
    expect(await fastPriceFeed.prices(token2.address)).eq(
      getExpandedPrice(price2, 100)
    );
    expect(await fastPriceFeed.prices(token3.address)).eq(
      getExpandedPrice(price3, 10)
    );
    expect(await fastPriceFeed.prices(token4.address)).eq(
      getExpandedPrice(price4, 1000)
    );
    expect(await fastPriceFeed.prices(token5.address)).eq(
      getExpandedPrice(price5, 10000)
    );
    expect(await fastPriceFeed.prices(token6.address)).eq(
      getExpandedPrice(price6, 1000)
    );
    expect(await fastPriceFeed.prices(token7.address)).eq(
      getExpandedPrice(price7, 1000)
    );
    expect(await fastPriceFeed.prices(token8.address)).eq(
      getExpandedPrice(price8, 100)
    );

    await fastPriceFeed
      .connect(wallet)
      .setTokens(
        [
          token1.address,
          token2.address,
          token3.address,
          token4.address,
          token5.address,
          token6.address,
          token7.address,
          token8.address,
          token9.address,
        ],
        [1000, 100, 10, 1000, 10000, 1000, 1000, 100, 10]
      );

    priceBitArray = getPriceBitArray([
      price1,
      price2,
      price3,
      price4,
      price5,
      price6,
      price7,
      price8,
      price9,
    ]);

    expect(priceBitArray.length).eq(2);

    await fastPriceFeed
      .connect(user0)
      .setCompactedPrices(priceBitArray, blockTime);

    expect(await fastPriceFeed.prices(token1.address)).eq(
      getExpandedPrice(price1, 1000)
    );
    expect(await fastPriceFeed.prices(token2.address)).eq(
      getExpandedPrice(price2, 100)
    );
    expect(await fastPriceFeed.prices(token3.address)).eq(
      getExpandedPrice(price3, 10)
    );
    expect(await fastPriceFeed.prices(token4.address)).eq(
      getExpandedPrice(price4, 1000)
    );
    expect(await fastPriceFeed.prices(token5.address)).eq(
      getExpandedPrice(price5, 10000)
    );
    expect(await fastPriceFeed.prices(token6.address)).eq(
      getExpandedPrice(price6, 1000)
    );
    expect(await fastPriceFeed.prices(token7.address)).eq(
      getExpandedPrice(price7, 1000)
    );
    expect(await fastPriceFeed.prices(token8.address)).eq(
      getExpandedPrice(price8, 100)
    );
    expect(await fastPriceFeed.prices(token9.address)).eq(
      getExpandedPrice(price9, 10)
    );

    await fastPriceFeed
      .connect(wallet)
      .setTokens(
        [
          token1.address,
          token2.address,
          token3.address,
          token4.address,
          token5.address,
          token6.address,
          token7.address,
          token8.address,
          token9.address,
          token10.address,
        ],
        [1000, 100, 10, 1000, 10000, 1000, 1000, 100, 10, 10000]
      );

    priceBitArray = getPriceBitArray([
      price1,
      price2,
      price3,
      price4,
      price5,
      price6,
      price7,
      price8,
      price9,
      price10,
    ]);

    expect(priceBitArray.length).eq(2);

    await fastPriceFeed
      .connect(user0)
      .setCompactedPrices(priceBitArray, blockTime);

    expect(await fastPriceFeed.prices(token1.address)).eq(
      getExpandedPrice(price1, 1000)
    );
    expect(await fastPriceFeed.prices(token2.address)).eq(
      getExpandedPrice(price2, 100)
    );
    expect(await fastPriceFeed.prices(token3.address)).eq(
      getExpandedPrice(price3, 10)
    );
    expect(await fastPriceFeed.prices(token4.address)).eq(
      getExpandedPrice(price4, 1000)
    );
    expect(await fastPriceFeed.prices(token5.address)).eq(
      getExpandedPrice(price5, 10000)
    );
    expect(await fastPriceFeed.prices(token6.address)).eq(
      getExpandedPrice(price6, 1000)
    );
    expect(await fastPriceFeed.prices(token7.address)).eq(
      getExpandedPrice(price7, 1000)
    );
    expect(await fastPriceFeed.prices(token8.address)).eq(
      getExpandedPrice(price8, 100)
    );
    expect(await fastPriceFeed.prices(token9.address)).eq(
      getExpandedPrice(price9, 10)
    );
    expect(await fastPriceFeed.prices(token10.address)).eq(
      getExpandedPrice(price10, 10000)
    );
  });

  it("setPricesWithBits", async () => {
    const price1 = "2009991111";
    const price2 = "1004445555";
    const price3 = "123";
    const price4 = "4567";
    const price5 = "891011";
    const price6 = "1213141516";
    const price7 = "234";
    const price8 = "5678";
    const price9 = "910910";
    const price10 = "10";

    const token1 = await deployContract("Token", []);
    const token2 = await deployContract("Token", []);
    const token3 = await deployContract("Token", []);
    const token4 = await deployContract("Token", []);
    const token5 = await deployContract("Token", []);
    const token6 = await deployContract("Token", []);
    const token7 = await deployContract("Token", []);
    const token8 = await deployContract("Token", []);
    const token9 = await deployContract("Token", []);
    const token10 = await deployContract("Token", []);

    await fastPriceFeed
      .connect(wallet)
      .setTokens([token1.address, token2.address], [1000, 1000]);
    await fastPriceFeed.setMaxTimeDeviation(1000);

    let priceBits = getPriceBits([price1, price2]);
    let blockTime = await getBlockTime(provider);

    await expect(
      fastPriceFeed.connect(user0).setPricesWithBits(priceBits, blockTime)
    ).to.be.revertedWith("FastPriceFeed: forbidden");

    await fastPriceFeed.connect(wallet).setUpdater(user0.address, true);

    expect(await fastPriceFeed.lastUpdatedAt()).eq(0);

    await fastPriceFeed.connect(user0).setPricesWithBits(priceBits, blockTime);

    expect(await fastPriceFeed.prices(token1.address)).eq(
      getExpandedPrice(price1, 1000)
    );
    expect(await fastPriceFeed.prices(token2.address)).eq(
      getExpandedPrice(price2, 1000)
    );

    expect(await fastPriceFeed.lastUpdatedAt()).eq(blockTime);

    await fastPriceFeed
      .connect(wallet)
      .setTokens([token1.address, token2.address], [1000, 10000]);

    blockTime = blockTime + 500;

    await fastPriceFeed.connect(user0).setPricesWithBits(priceBits, blockTime);

    expect(await fastPriceFeed.prices(token1.address)).eq(
      getExpandedPrice(price1, 1000)
    );
    expect(await fastPriceFeed.prices(token2.address)).eq(
      getExpandedPrice(price2, 10000)
    );

    expect(await fastPriceFeed.lastUpdatedAt()).eq(blockTime);

    await fastPriceFeed
      .connect(wallet)
      .setTokens(
        [
          token1.address,
          token2.address,
          token3.address,
          token4.address,
          token5.address,
          token6.address,
          token7.address,
        ],
        [1000, 100, 10, 1000, 10000, 1000, 1000]
      );

    priceBits = getPriceBits([
      price1,
      price2,
      price3,
      price4,
      price5,
      price6,
      price7,
    ]);

    await fastPriceFeed.connect(user0).setPricesWithBits(priceBits, blockTime);

    const p1 = await fastPriceFeed.prices(token1.address);
    expect(ethers.utils.formatUnits(p1, 30)).eq("2009991.111");
    expect(await fastPriceFeed.prices(token1.address)).eq(
      "2009991111000000000000000000000000000"
    );
    expect(await fastPriceFeed.prices(token2.address)).eq(
      getExpandedPrice(price2, 100)
    );
    expect(await fastPriceFeed.prices(token3.address)).eq(
      getExpandedPrice(price3, 10)
    );
    expect(await fastPriceFeed.prices(token4.address)).eq(
      getExpandedPrice(price4, 1000)
    );
    expect(await fastPriceFeed.prices(token5.address)).eq(
      getExpandedPrice(price5, 10000)
    );
    expect(await fastPriceFeed.prices(token6.address)).eq(
      getExpandedPrice(price6, 1000)
    );
    expect(await fastPriceFeed.prices(token7.address)).eq(
      getExpandedPrice(price7, 1000)
    );

    await fastPriceFeed
      .connect(wallet)
      .setTokens(
        [
          token1.address,
          token2.address,
          token3.address,
          token4.address,
          token5.address,
          token6.address,
          token7.address,
          token8.address,
        ],
        [1000, 100, 10, 1000, 10000, 1000, 1000, 100]
      );

    priceBits = getPriceBits([
      price1,
      price2,
      price3,
      price4,
      price5,
      price6,
      price7,
      price8,
    ]);

    await fastPriceFeed.connect(user0).setPricesWithBits(priceBits, blockTime);

    expect(await fastPriceFeed.prices(token1.address)).eq(
      getExpandedPrice(price1, 1000)
    );
    expect(await fastPriceFeed.prices(token2.address)).eq(
      getExpandedPrice(price2, 100)
    );
    expect(await fastPriceFeed.prices(token3.address)).eq(
      getExpandedPrice(price3, 10)
    );
    expect(await fastPriceFeed.prices(token4.address)).eq(
      getExpandedPrice(price4, 1000)
    );
    expect(await fastPriceFeed.prices(token5.address)).eq(
      getExpandedPrice(price5, 10000)
    );
    expect(await fastPriceFeed.prices(token6.address)).eq(
      getExpandedPrice(price6, 1000)
    );
    expect(await fastPriceFeed.prices(token7.address)).eq(
      getExpandedPrice(price7, 1000)
    );
    expect(await fastPriceFeed.prices(token8.address)).eq(
      getExpandedPrice(price8, 100)
    );

    priceBits = getPriceBits([
      price1,
      price2,
      price3,
      price4,
      price5,
      price6,
      price7,
      price9,
    ]);

    await mineBlock(provider);
    await fastPriceFeed.connect(user0).setPricesWithBits(priceBits, blockTime);

    expect(await fastPriceFeed.prices(token1.address)).eq(
      getExpandedPrice(price1, 1000)
    );
    expect(await fastPriceFeed.prices(token2.address)).eq(
      getExpandedPrice(price2, 100)
    );
    expect(await fastPriceFeed.prices(token3.address)).eq(
      getExpandedPrice(price3, 10)
    );
    expect(await fastPriceFeed.prices(token4.address)).eq(
      getExpandedPrice(price4, 1000)
    );
    expect(await fastPriceFeed.prices(token5.address)).eq(
      getExpandedPrice(price5, 10000)
    );
    expect(await fastPriceFeed.prices(token6.address)).eq(
      getExpandedPrice(price6, 1000)
    );
    expect(await fastPriceFeed.prices(token7.address)).eq(
      getExpandedPrice(price7, 1000)
    );
    expect(await fastPriceFeed.prices(token8.address)).eq(
      getExpandedPrice(price9, 100)
    );

    priceBits = getPriceBits([
      price7,
      price1,
      price3,
      price4,
      price5,
      price6,
      price7,
      price8,
    ]);

    await mineBlock(provider);
    await fastPriceFeed
      .connect(user0)
      .setPricesWithBits(priceBits, blockTime - 1);

    expect(await fastPriceFeed.prices(token1.address)).eq(
      getExpandedPrice(price1, 1000)
    );
    expect(await fastPriceFeed.prices(token2.address)).eq(
      getExpandedPrice(price2, 100)
    );
    expect(await fastPriceFeed.prices(token3.address)).eq(
      getExpandedPrice(price3, 10)
    );
    expect(await fastPriceFeed.prices(token4.address)).eq(
      getExpandedPrice(price4, 1000)
    );
    expect(await fastPriceFeed.prices(token5.address)).eq(
      getExpandedPrice(price5, 10000)
    );
    expect(await fastPriceFeed.prices(token6.address)).eq(
      getExpandedPrice(price6, 1000)
    );
    expect(await fastPriceFeed.prices(token7.address)).eq(
      getExpandedPrice(price7, 1000)
    );
    expect(await fastPriceFeed.prices(token8.address)).eq(
      getExpandedPrice(price9, 100)
    );

    await mineBlock(provider);
    await fastPriceFeed
      .connect(user0)
      .setPricesWithBits(priceBits, blockTime + 1);

    expect(await fastPriceFeed.prices(token1.address)).eq(
      getExpandedPrice(price7, 1000)
    );
    expect(await fastPriceFeed.prices(token2.address)).eq(
      getExpandedPrice(price1, 100)
    );
    expect(await fastPriceFeed.prices(token3.address)).eq(
      getExpandedPrice(price3, 10)
    );
    expect(await fastPriceFeed.prices(token4.address)).eq(
      getExpandedPrice(price4, 1000)
    );
    expect(await fastPriceFeed.prices(token5.address)).eq(
      getExpandedPrice(price5, 10000)
    );
    expect(await fastPriceFeed.prices(token6.address)).eq(
      getExpandedPrice(price6, 1000)
    );
    expect(await fastPriceFeed.prices(token7.address)).eq(
      getExpandedPrice(price7, 1000)
    );
    expect(await fastPriceFeed.prices(token8.address)).eq(
      getExpandedPrice(price8, 100)
    );
  });
});
