const { expect, use } = require("chai");
const { solidity } = require("ethereum-waffle");
const { deployContract } = require("../shared/fixtures");
const {
  expandDecimals,
  getBlockTime,
  increaseTime,
  mineBlock,
  reportGasUsed,
  newWallet,
} = require("../shared/utilities");
const { toChainlinkPrice } = require("../shared/chainlink");
const { toUsd, toNormalizedPrice } = require("../shared/units");
const {
  initVault,
  getBnbConfig,
  getBtcConfig,
  getDaiConfig,
} = require("./Vault/helpers");

use(solidity);

describe("ComplexOrderRouter", function () {
  const { AddressZero, HashZero } = ethers.constants;
  const provider = waffle.provider;
  const [
    wallet,
    positionKeeper,
    minter,
    user0,
    user1,
    user2,
    user3,
    user4,
    user5,
    tokenManager,
    mintReceiver,
  ] = provider.getWallets();
  const depositFee = 50;
  const minExecutionFee = 4000;
  let vault;
  let timelock;
  let usdg;
  let router;
  let positionRouter;
  let referralStorage;
  let vaultPriceFeed;
  let bnb;
  let bnbPriceFeed;
  let btc;
  let btcPriceFeed;
  let eth;
  let ethPriceFeed;
  let dai;
  let daiPriceFeed;
  let busd;
  let busdPriceFeed;
  let distributor0;
  let yieldTracker0;
  let reader;

  beforeEach(async () => {
    bnb = await deployContract("Token", []);
    bnbPriceFeed = await deployContract("PriceFeed", []);
    await bnb.connect(minter).deposit({ value: expandDecimals(100, 18) });

    btc = await deployContract("Token", []);
    btcPriceFeed = await deployContract("PriceFeed", []);

    eth = await deployContract("Token", []);
    ethPriceFeed = await deployContract("PriceFeed", []);

    dai = await deployContract("Token", []);
    daiPriceFeed = await deployContract("PriceFeed", []);

    busd = await deployContract("Token", []);
    busdPriceFeed = await deployContract("PriceFeed", []);

    vault = await deployContract("Vault", []);
    timelock = await deployContract("Timelock", [
      wallet.address,
      5 * 24 * 60 * 60,
      tokenManager.address,
      AddressZero,
      AddressZero,
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
    referralStorage = await deployContract("ReferralStorage", []);
    vaultPriceFeed = await deployContract("VaultPriceFeed", []);
    await positionRouter.setReferralStorage(referralStorage.address);
    await referralStorage.setHandler(positionRouter.address, true);

    await initVault(vault, router, usdg, vaultPriceFeed);

    distributor0 = await deployContract("TimeDistributor", []);
    yieldTracker0 = await deployContract("YieldTracker", [usdg.address]);

    await yieldTracker0.setDistributor(distributor0.address);
    await distributor0.setDistribution(
      [yieldTracker0.address],
      [1000],
      [bnb.address]
    );

    orderBook = await deployContract("OrderBook", []);
    await orderBook.initialize(
      router.address,
      vault.address,
      bnb.address,
      usdg.address,
      minExecutionFee,
      expandDecimals(5, 30) // minPurchseTokenAmountUsd
    );

    await router.addPlugin(orderBook.address);
    await router.connect(user0).approvePlugin(orderBook.address);

    complexOrderRouter = await deployContract("ComplexOrderRouter", [
      orderBook.address,
      positionRouter.address,
      bnb.address,
    ]);

    await orderBook.setComplexOrderRouter(complexOrderRouter.address);
    await positionRouter.setComplexOrderRouter(complexOrderRouter.address);

    await bnb.mint(distributor0.address, 5000);
    await usdg.setYieldTrackers([yieldTracker0.address]);

    reader = await deployContract("Reader", []);

    await vaultPriceFeed.setTokenConfig(
      bnb.address,
      bnbPriceFeed.address,
      8,
      false
    );
    await vaultPriceFeed.setTokenConfig(
      btc.address,
      btcPriceFeed.address,
      8,
      false
    );
    await vaultPriceFeed.setTokenConfig(
      eth.address,
      ethPriceFeed.address,
      8,
      false
    );
    await vaultPriceFeed.setTokenConfig(
      dai.address,
      daiPriceFeed.address,
      8,
      false
    );

    await daiPriceFeed.setLatestAnswer(toChainlinkPrice(1));
    await vault.setTokenConfig(...getDaiConfig(dai, daiPriceFeed));

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));
    await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed));

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300));
    await vault.setTokenConfig(...getBnbConfig(bnb, bnbPriceFeed));

    await vault.setIsLeverageEnabled(false);
    await vault.setGov(timelock.address);
  });

  it("inits", async () => {
    expect(await positionRouter.vault()).eq(vault.address);
    expect(await positionRouter.router()).eq(router.address);
    expect(await positionRouter.weth()).eq(bnb.address);
    expect(await positionRouter.depositFee()).eq(depositFee);
    expect(await positionRouter.minExecutionFee()).eq(minExecutionFee);
    expect(await positionRouter.admin()).eq(wallet.address);
    expect(await positionRouter.gov()).eq(wallet.address);
  });

  it("createComplexOrder, executeIncreasePosition, cancelIncreasePosition", async () => {
    const referralCode =
      "0x0000000000000000000000000000000000000000000000000000000000000123";

    const params = [
      [dai.address, bnb.address], // _path
      expandDecimals(600, 18), // _amountIn
      expandDecimals(1, 18), // _minOut
      true, // _isLong
      referralCode,
      [toUsd(6000)], // _sizeDelta
      [toUsd(300)], // _price
      [bnb.address], // _token
      [ethers.BigNumber.from(3000)], // _executionFee
    ];

    await expect(
      complexOrderRouter.connect(user0).createComplexOrder(...params, {
        value: 3000,
      })
    ).to.be.revertedWith("ComplexOrderRouter: invalid _sizeDelta length");
    params[5] = [toUsd(6000), toUsd(6000), toUsd(6000)];
    await expect(
      complexOrderRouter.connect(user0).createComplexOrder(...params, {
        value: 3000,
      })
    ).to.be.revertedWith("ComplexOrderRouter: invalid _price length");
    params[6] = [toUsd(300), toUsd(300), toUsd(300)];
    await expect(
      complexOrderRouter.connect(user0).createComplexOrder(...params, {
        value: 3000,
      })
    ).to.be.revertedWith("ComplexOrderRouter: invalid _token length");
    params[7] = [bnb.address, bnb.address, bnb.address];
    await expect(
      complexOrderRouter.connect(user0).createComplexOrder(...params, {
        value: 3000,
      })
    ).to.be.revertedWith("ComplexOrderRouter: invalid _executionFee length");
    params[8] = [
      ethers.BigNumber.from(4000),
      ethers.BigNumber.from(5000),
      ethers.BigNumber.from(5000),
    ];

    await expect(
      complexOrderRouter.connect(user0).createComplexOrder(...params)
    ).to.be.revertedWith("ComplexOrderRouter: invalid msg.value");

    await expect(
      complexOrderRouter.connect(user0).createComplexOrder(...params, {
        value: 2000,
      })
    ).to.be.revertedWith("ComplexOrderRouter: invalid msg.value");

    params[0] = [];
    await expect(
      complexOrderRouter.connect(user0).createComplexOrder(...params, {
        value: 14000,
      })
    ).to.be.revertedWith("ComplexOrderRouter: invalid _path length");

    params[0] = [dai.address, bnb.address, bnb.address];

    await expect(
      complexOrderRouter.connect(user0).createComplexOrder(...params, {
        value: 14000,
      })
    ).to.be.revertedWith("ComplexOrderRouter: invalid _path length");

    params[0] = [dai.address, bnb.address];
    await expect(
      complexOrderRouter.connect(user0).createComplexOrder(...params, {
        value: 14000,
      })
    ).to.be.revertedWith("Router: invalid plugin");

    await router.addPlugin(positionRouter.address);

    await expect(
      complexOrderRouter.connect(user0).createComplexOrder(...params, {
        value: 14000,
      })
    ).to.be.revertedWith("Router: plugin not approved");

    await router.connect(user0).approvePlugin(positionRouter.address);

    await expect(
      complexOrderRouter.connect(user0).createComplexOrder(...params, {
        value: 14000,
      })
    ).to.be.revertedWith("ERC20: transfer amount exceeds balance");

    await dai.mint(user0.address, expandDecimals(600, 18));

    await expect(
      complexOrderRouter.connect(user0).createComplexOrder(...params, {
        value: 14000,
      })
    ).to.be.revertedWith("ERC20: transfer amount exceeds allowance");

    await dai.connect(user0).approve(router.address, expandDecimals(600, 18));

    let key = await positionRouter.getRequestKey(user0.address, 1);
    let request = await positionRouter.increasePositionRequests(key);

    expect(await referralStorage.traderReferralCodes(user0.address)).eq(
      HashZero
    );
    expect(await dai.balanceOf(positionRouter.address)).eq(0);
    expect(await positionRouter.increasePositionsIndex(user0.address)).eq(0);

    expect(request.account).eq(AddressZero);
    expect(request.path).eq(undefined);
    expect(request.indexToken).eq(AddressZero);
    expect(request.amountIn).eq(0);
    expect(request.minOut).eq(0);
    expect(request.sizeDelta).eq(0);
    expect(request.isLong).eq(false);
    expect(request.acceptablePrice).eq(0);
    expect(request.executionFee).eq(0);
    expect(request.blockNumber).eq(0);
    expect(request.blockTime).eq(0);
    expect(request.hasCollateralInETH).eq(false);

    let queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(0); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(0); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0); // decreasePositionRequestKeys.length

    expect(await provider.getBalance(positionRouter.address)).eq(0);
    expect(await bnb.balanceOf(positionRouter.address)).eq(0);
    expect(await dai.balanceOf(positionRouter.address)).eq(0);

    const tx0 = await complexOrderRouter
      .connect(user0)
      .createComplexOrder(...params, {
        value: 14000,
      });
    await reportGasUsed(provider, tx0, "createComplexOrder gas used");

    expect(await provider.getBalance(positionRouter.address)).eq(0);
    expect(await bnb.balanceOf(positionRouter.address)).eq(4000);
    expect(await dai.balanceOf(positionRouter.address)).eq(
      expandDecimals(600, 18)
    );

    const blockNumber = await provider.getBlockNumber();
    const blockTime = await getBlockTime(provider);

    request = await positionRouter.increasePositionRequests(key);

    expect(await referralStorage.traderReferralCodes(user0.address)).eq(
      referralCode
    );
    expect(await dai.balanceOf(positionRouter.address)).eq(
      expandDecimals(600, 18)
    );
    expect(await positionRouter.increasePositionsIndex(user0.address)).eq(1);

    expect(request.account).eq(user0.address);
    expect(request.path).eq(undefined);
    expect(request.indexToken).eq(bnb.address);
    expect(request.amountIn).eq(expandDecimals(600, 18));
    expect(request.minOut).eq(expandDecimals(1, 18));
    expect(request.sizeDelta).eq(toUsd(6000));
    expect(request.isLong).eq(true);
    expect(request.acceptablePrice).eq(toUsd(300));
    expect(request.executionFee).eq(4000);
    expect(request.blockNumber).eq(blockNumber);
    expect(request.blockTime).eq(blockTime);
    expect(request.hasCollateralInETH).eq(false);

    queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(0); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(1); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0); // decreasePositionRequestKeys.length

    await positionRouter.setDelayValues(5, 300, 500);

    const executionFeeReceiver = newWallet();
    await expect(
      positionRouter
        .connect(positionKeeper)
        .executeIncreasePosition(key, executionFeeReceiver.address)
    ).to.be.revertedWith("PositionRouter: forbidden");

    await positionRouter.setPositionKeeper(positionKeeper.address, true);

    // executeIncreasePosition will return without error and without executing the position if the minBlockDelayKeeper has not yet passed
    await positionRouter
      .connect(positionKeeper)
      .executeIncreasePosition(key, executionFeeReceiver.address);

    request = await positionRouter.increasePositionRequests(key);
    expect(request.account).eq(user0.address);

    await mineBlock(provider);

    await expect(
      positionRouter
        .connect(positionKeeper)
        .executeIncreasePosition(key, executionFeeReceiver.address)
    ).to.be.revertedWith("Vault: poolAmount exceeded");

    await bnb.mint(vault.address, expandDecimals(30, 18));
    await vault.buyUSDG(bnb.address, user1.address);

    await expect(
      positionRouter
        .connect(positionKeeper)
        .executeIncreasePosition(key, executionFeeReceiver.address)
    ).to.be.revertedWith("Timelock: forbidden");

    await timelock.setContractHandler(positionRouter.address, true);

    await expect(
      positionRouter
        .connect(positionKeeper)
        .executeIncreasePosition(key, executionFeeReceiver.address)
    ).to.be.revertedWith("Vault: leverage not enabled");

    await timelock.setShouldToggleIsLeverageEnabled(true);

    let position = await vault.getPosition(
      user0.address,
      bnb.address,
      bnb.address,
      true
    );
    expect(position[0]).eq(0); // size
    expect(position[1]).eq(0); // collateral
    expect(position[2]).eq(0); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(0); // reserveAmount
    expect(position[5]).eq(0); // realisedPnl
    expect(position[6]).eq(true); // hasProfit
    expect(position[7]).eq(0); // lastIncreasedTime

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(0);

    const tx1 = await positionRouter
      .connect(positionKeeper)
      .executeIncreasePosition(key, executionFeeReceiver.address);
    await reportGasUsed(provider, tx1, "executeIncreasePosition gas used");

    expect(await provider.getBalance(positionRouter.address)).eq(0);
    expect(await bnb.balanceOf(positionRouter.address)).eq(0);
    expect(await dai.balanceOf(positionRouter.address)).eq(0);

    request = await positionRouter.increasePositionRequests(key);

    expect(request.account).eq(AddressZero);
    expect(request.path).eq(undefined);
    expect(request.indexToken).eq(AddressZero);
    expect(request.amountIn).eq(0);
    expect(request.minOut).eq(0);
    expect(request.sizeDelta).eq(0);
    expect(request.isLong).eq(false);
    expect(request.acceptablePrice).eq(0);
    expect(request.executionFee).eq(0);
    expect(request.blockNumber).eq(0);
    expect(request.blockTime).eq(0);
    expect(request.hasCollateralInETH).eq(false);

    position = await vault.getPosition(
      user0.address,
      bnb.address,
      bnb.address,
      true
    );
    expect(position[0]).eq(toUsd(6000)); // size
    expect(position[1]).eq("592200000000000000000000000000000"); // collateral, 592.2
    expect(position[2]).eq(toUsd(300)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(expandDecimals(20, 18)); // reserveAmount
    expect(position[5]).eq(0); // realisedPnl
    expect(position[6]).eq(true); // hasProfit

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(4000);

    queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(0); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(1); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0); // decreasePositionRequestKeys.length

    await dai.mint(user1.address, expandDecimals(600, 18));
    await dai.connect(user1).approve(router.address, expandDecimals(600, 18));
    await router.connect(user1).approvePlugin(positionRouter.address);

    await complexOrderRouter.connect(user1).createComplexOrder(...params, {
      value: 14000,
    });

    expect(await provider.getBalance(positionRouter.address)).eq(0);
    expect(await bnb.balanceOf(positionRouter.address)).eq(4000);
    expect(await dai.balanceOf(positionRouter.address)).eq(
      expandDecimals(600, 18)
    );
    expect(await dai.balanceOf(user1.address)).eq(0);

    key = await positionRouter.getRequestKey(user1.address, 1);
    request = await positionRouter.increasePositionRequests(key);
    expect(request.account).eq(user1.address);

    await positionRouter
      .connect(positionKeeper)
      .cancelIncreasePosition(key, executionFeeReceiver.address);
    request = await positionRouter.increasePositionRequests(key);
    expect(request.account).eq(user1.address);

    await mineBlock(provider);
    await mineBlock(provider);
    await mineBlock(provider);

    const tx2 = await positionRouter
      .connect(positionKeeper)
      .cancelIncreasePosition(key, executionFeeReceiver.address);
    await reportGasUsed(provider, tx2, "cancelIncreasePosition gas used");

    request = await positionRouter.increasePositionRequests(key);
    expect(request.account).eq(AddressZero);

    expect(await provider.getBalance(positionRouter.address)).eq(0);
    expect(await bnb.balanceOf(positionRouter.address)).eq(0);
    expect(await dai.balanceOf(positionRouter.address)).eq(0);
    expect(await dai.balanceOf(user1.address)).eq(expandDecimals(600, 18));

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(8000);

    await dai.mint(user2.address, expandDecimals(600, 18));
    await dai.connect(user2).approve(router.address, expandDecimals(600, 18));
    await router.connect(user2).approvePlugin(positionRouter.address);

    params[0] = [dai.address]; // _path
    params[3] = false; // _isLong

    const tx3 = await complexOrderRouter
      .connect(user2)
      .createComplexOrder(...params, {
        value: 14000,
      });
    await reportGasUsed(provider, tx3, "createIncreasePosition gas used");

    key = await positionRouter.getRequestKey(user2.address, 1);

    await mineBlock(provider);
    await mineBlock(provider);

    await dai.mint(vault.address, expandDecimals(7000, 18));
    await vault.buyUSDG(dai.address, user1.address);

    const tx4 = await positionRouter
      .connect(positionKeeper)
      .executeIncreasePosition(key, executionFeeReceiver.address);
    await reportGasUsed(provider, tx4, "executeIncreasePosition gas used");

    request = await positionRouter.increasePositionRequests(key);
    expect(request.account).eq(AddressZero);

    position = await vault.getPosition(
      user2.address,
      dai.address,
      bnb.address,
      false
    );
    expect(position[0]).eq(toUsd(6000)); // size
    expect(position[1]).eq("594000000000000000000000000000000"); // collateral, 594
    expect(position[2]).eq(toUsd(300)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(expandDecimals(6000, 18)); // reserveAmount
    expect(position[5]).eq(0); // realisedPnl
    expect(position[6]).eq(true); // hasProfit

    queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(0); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(3); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0); // decreasePositionRequestKeys.length
  });

  it("createIncreasePositionETH, executeIncreasePosition, cancelIncreasePosition", async () => {
    const referralCode =
      "0x0000000000000000000000000000000000000000000000000000000000000123";

    const params = [
      [dai.address, bnb.address], // _path
      expandDecimals(290, 18), // _minOut
      false, // _isLong
      referralCode,
      [toUsd(6000)], // _sizeDelta
      [toUsd(300)], // _price
      [bnb.address], // _token
      [ethers.BigNumber.from(3000)], // _executionFee
    ];

    await expect(
      complexOrderRouter.connect(user0).createComplexOrderETH(...params, {
        value: 3000,
      })
    ).to.be.revertedWith("ComplexOrderRouter: invalid _sizeDelta length");
    params[4] = [toUsd(6000), toUsd(6000), toUsd(6000)];
    await expect(
      complexOrderRouter.connect(user0).createComplexOrderETH(...params, {
        value: 3000,
      })
    ).to.be.revertedWith("ComplexOrderRouter: invalid _price length");
    params[5] = [toUsd(300), toUsd(300), toUsd(300)];
    await expect(
      complexOrderRouter.connect(user0).createComplexOrderETH(...params, {
        value: 3000,
      })
    ).to.be.revertedWith("ComplexOrderRouter: invalid _token length");
    params[6] = [bnb.address, bnb.address, bnb.address];
    await expect(
      complexOrderRouter.connect(user0).createComplexOrderETH(...params, {
        value: 3000,
      })
    ).to.be.revertedWith("ComplexOrderRouter: invalid _executionFee length");
    params[7] = [
      ethers.BigNumber.from(4000),
      ethers.BigNumber.from(5000),
      ethers.BigNumber.from(5000),
    ];

    await expect(
      complexOrderRouter.connect(user0).createComplexOrderETH(...params)
    ).to.be.revertedWith("ComplexOrderRouter: invalid msg.value");

    await expect(
      complexOrderRouter.connect(user0).createComplexOrderETH(...params, {
        value: 2000,
      })
    ).to.be.revertedWith("ComplexOrderRouter: invalid msg.value");

    params[0] = [];
    await expect(
      complexOrderRouter.connect(user0).createComplexOrderETH(...params, {
        value: 14000,
      })
    ).to.be.revertedWith("ComplexOrderRouter: invalid _path length");

    params[0] = [dai.address, bnb.address, bnb.address];

    await expect(
      complexOrderRouter.connect(user0).createComplexOrderETH(...params, {
        value: 14000,
      })
    ).to.be.revertedWith("ComplexOrderRouter: invalid _path length");

    params[0] = [bnb.address, dai.address];

    key = await positionRouter.getRequestKey(user0.address, 1);
    let request = await positionRouter.increasePositionRequests(key);

    expect(await referralStorage.traderReferralCodes(user0.address)).eq(
      HashZero
    );
    expect(await bnb.balanceOf(positionRouter.address)).eq(0);
    expect(await positionRouter.increasePositionsIndex(user0.address)).eq(0);

    expect(request.account).eq(AddressZero);
    expect(request.path).eq(undefined);
    expect(request.indexToken).eq(AddressZero);
    expect(request.amountIn).eq(0);
    expect(request.minOut).eq(0);
    expect(request.sizeDelta).eq(0);
    expect(request.isLong).eq(false);
    expect(request.acceptablePrice).eq(0);
    expect(request.executionFee).eq(0);
    expect(request.blockNumber).eq(0);
    expect(request.blockTime).eq(0);
    expect(request.hasCollateralInETH).eq(false);

    let queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(0); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(0); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0); // decreasePositionRequestKeys.length

    expect(await provider.getBalance(positionRouter.address)).eq(0);
    expect(await bnb.balanceOf(positionRouter.address)).eq(0);
    expect(await dai.balanceOf(positionRouter.address)).eq(0);

    const tx = await complexOrderRouter
      .connect(user0)
      .createComplexOrderETH(...params, {
        value: expandDecimals(1, 18).add(14000),
      });
    await reportGasUsed(provider, tx, "createIncreasePositionETH gas used");

    expect(await provider.getBalance(positionRouter.address)).eq(0);
    expect(await bnb.balanceOf(positionRouter.address)).eq(
      expandDecimals(1, 18).add(4000)
    );
    expect(await dai.balanceOf(positionRouter.address)).eq(0);

    const blockNumber = await provider.getBlockNumber();
    const blockTime = await getBlockTime(provider);

    request = await positionRouter.increasePositionRequests(key);

    expect(await referralStorage.traderReferralCodes(user0.address)).eq(
      referralCode
    );
    expect(await bnb.balanceOf(positionRouter.address)).eq(
      expandDecimals(1, 18).add(4000)
    );
    expect(await positionRouter.increasePositionsIndex(user0.address)).eq(1);

    expect(request.account).eq(user0.address);
    expect(request.path).eq(undefined);
    expect(request.indexToken).eq(bnb.address);
    expect(request.amountIn).eq(expandDecimals(1, 18));
    expect(request.minOut).eq(expandDecimals(290, 18));
    expect(request.sizeDelta).eq(toUsd(6000));
    expect(request.isLong).eq(false);
    expect(request.acceptablePrice).eq(toUsd(300));
    expect(request.executionFee).eq(4000);
    expect(request.blockNumber).eq(blockNumber);
    expect(request.blockTime).eq(blockTime);
    expect(request.hasCollateralInETH).eq(true);

    queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(0); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(1); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0); // decreasePositionRequestKeys.length

    await positionRouter.setDelayValues(5, 300, 500);

    const executionFeeReceiver = newWallet();
    await expect(
      positionRouter
        .connect(positionKeeper)
        .executeIncreasePosition(key, executionFeeReceiver.address)
    ).to.be.revertedWith("PositionRouter: forbidden");

    await positionRouter.setPositionKeeper(positionKeeper.address, true);

    // executeIncreasePosition will return without error and without executing the position if the minBlockDelayKeeper has not yet passed
    await positionRouter
      .connect(positionKeeper)
      .executeIncreasePosition(key, executionFeeReceiver.address);

    request = await positionRouter.increasePositionRequests(key);
    expect(request.account).eq(user0.address);

    await mineBlock(provider);

    await expect(
      positionRouter
        .connect(positionKeeper)
        .executeIncreasePosition(key, executionFeeReceiver.address)
    ).to.be.revertedWith("Vault: poolAmount exceeded");

    await dai.mint(vault.address, expandDecimals(7000, 18));
    await vault.buyUSDG(dai.address, user1.address);

    await expect(
      positionRouter
        .connect(positionKeeper)
        .executeIncreasePosition(key, executionFeeReceiver.address)
    ).to.be.revertedWith("Timelock: forbidden");

    await timelock.setContractHandler(positionRouter.address, true);

    await expect(
      positionRouter
        .connect(positionKeeper)
        .executeIncreasePosition(key, executionFeeReceiver.address)
    ).to.be.revertedWith("Router: invalid plugin");

    await router.addPlugin(positionRouter.address);

    await expect(
      positionRouter
        .connect(positionKeeper)
        .executeIncreasePosition(key, executionFeeReceiver.address)
    ).to.be.revertedWith("Router: plugin not approved");

    await router.connect(user0).approvePlugin(positionRouter.address);

    await expect(
      positionRouter
        .connect(positionKeeper)
        .executeIncreasePosition(key, executionFeeReceiver.address)
    ).to.be.revertedWith("Vault: leverage not enabled");

    await timelock.setShouldToggleIsLeverageEnabled(true);
    let position = await vault.getPosition(
      user0.address,
      bnb.address,
      bnb.address,
      true
    );
    expect(position[0]).eq(0); // size
    expect(position[1]).eq(0); // collateral
    expect(position[2]).eq(0); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(0); // reserveAmount
    expect(position[5]).eq(0); // realisedPnl
    expect(position[6]).eq(true); // hasProfit
    expect(position[7]).eq(0); // lastIncreasedTime

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(0);

    const tx1 = await positionRouter
      .connect(positionKeeper)
      .executeIncreasePosition(key, executionFeeReceiver.address);
    await reportGasUsed(provider, tx1, "executeIncreasePosition gas used");

    expect(await provider.getBalance(positionRouter.address)).eq(0);
    expect(await bnb.balanceOf(positionRouter.address)).eq(0);
    expect(await dai.balanceOf(positionRouter.address)).eq(0);

    request = await positionRouter.increasePositionRequests(key);

    expect(request.account).eq(AddressZero);
    expect(request.path).eq(undefined);
    expect(request.indexToken).eq(AddressZero);
    expect(request.amountIn).eq(0);
    expect(request.minOut).eq(0);
    expect(request.sizeDelta).eq(0);
    expect(request.isLong).eq(false);
    expect(request.acceptablePrice).eq(0);
    expect(request.executionFee).eq(0);
    expect(request.blockNumber).eq(0);
    expect(request.blockTime).eq(0);
    expect(request.hasCollateralInETH).eq(false);

    position = await vault.getPosition(
      user0.address,
      dai.address,
      bnb.address,
      false
    );
    expect(position[0]).eq(toUsd(6000)); // size
    expect(position[1]).eq("293100000000000000000000000000000"); // collateral, 293.1
    expect(position[2]).eq(toUsd(300)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(expandDecimals(6000, 18)); // reserveAmount
    expect(position[5]).eq(0); // realisedPnl
    expect(position[6]).eq(true); // hasProfit

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(4000);

    queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(0); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(1); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0); // decreasePositionRequestKeys.length

    await router.connect(user1).approvePlugin(positionRouter.address);
    await complexOrderRouter
      .connect(user1)
      .createComplexOrderETH(...params, {
        value: expandDecimals(1, 18).add(14000),
      });

    expect(await provider.getBalance(positionRouter.address)).eq(0);
    expect(await bnb.balanceOf(positionRouter.address)).eq(
      expandDecimals(1, 18).add(4000)
    );
    expect(await dai.balanceOf(positionRouter.address)).eq(0);
    expect(await dai.balanceOf(user1.address)).eq(0);

    key = await positionRouter.getRequestKey(user1.address, 1);
    request = await positionRouter.increasePositionRequests(key);
    expect(request.account).eq(user1.address);

    await positionRouter
      .connect(positionKeeper)
      .cancelIncreasePosition(key, executionFeeReceiver.address);
    request = await positionRouter.increasePositionRequests(key);
    expect(request.account).eq(user1.address);

    await mineBlock(provider);
    await mineBlock(provider);
    await mineBlock(provider);

    const balanceBefore = await provider.getBalance(user1.address);
    const tx2 = await positionRouter
      .connect(positionKeeper)
      .cancelIncreasePosition(key, executionFeeReceiver.address);
    await reportGasUsed(provider, tx2, "cancelIncreasePosition gas used");

    request = await positionRouter.increasePositionRequests(key);
    expect(request.account).eq(AddressZero);

    expect(await provider.getBalance(positionRouter.address)).eq(0);
    expect((await provider.getBalance(user1.address)).sub(balanceBefore)).eq(
      expandDecimals(1, 18)
    );
    expect(await bnb.balanceOf(positionRouter.address)).eq(0);
    expect(await dai.balanceOf(positionRouter.address)).eq(0);
    expect(await dai.balanceOf(user1.address)).eq(0);

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(8000);

    await router.connect(user2).approvePlugin(positionRouter.address);

    params[0] = [bnb.address]; // _path
    params[2] = true; // _isLong

    const tx3 = await complexOrderRouter
      .connect(user2)
      .createComplexOrderETH(...params, {
        value: expandDecimals(1, 18).add(14000),
      });
    await reportGasUsed(provider, tx3, "createIncreasePosition gas used");

    key = await positionRouter.getRequestKey(user2.address, 1);

    await mineBlock(provider);
    await mineBlock(provider);

    await bnb.mint(vault.address, expandDecimals(25, 18));
    await vault.buyUSDG(bnb.address, user1.address);

    const tx4 = await positionRouter
      .connect(positionKeeper)
      .executeIncreasePosition(key, executionFeeReceiver.address);
    await reportGasUsed(provider, tx4, "executeIncreasePosition gas used");

    request = await positionRouter.increasePositionRequests(key);
    expect(request.account).eq(AddressZero);

    position = await vault.getPosition(
      user2.address,
      bnb.address,
      bnb.address,
      true
    );
    expect(position[0]).eq(toUsd(6000)); // size
    expect(position[1]).eq("294000000000000000000000000000000"); // collateral, 294
    expect(position[2]).eq(toUsd(300)); // averagePrice
    expect(position[3]).eq(0); // entryFundingRate
    expect(position[4]).eq(expandDecimals(20, 18)); // reserveAmount
    expect(position[5]).eq(0); // realisedPnl
    expect(position[6]).eq(true); // hasProfit

    queueLengths = await positionRouter.getRequestQueueLengths();
    expect(queueLengths[0]).eq(0); // increasePositionRequestKeysStart
    expect(queueLengths[1]).eq(3); // increasePositionRequestKeys.length
    expect(queueLengths[2]).eq(0); // decreasePositionRequestKeysStart
    expect(queueLengths[3]).eq(0); // decreasePositionRequestKeys.length
  });
});
