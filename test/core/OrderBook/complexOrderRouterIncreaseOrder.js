const { expect, use } = require("chai");
const { solidity } = require("ethereum-waffle");
const { deployContract } = require("../../shared/fixtures");
const {
  expandDecimals,
  reportGasUsed,
  gasUsed,
} = require("../../shared/utilities");
const { toChainlinkPrice } = require("../../shared/chainlink");
const { toUsd, toNormalizedPrice } = require("../../shared/units");
const {
  initVault,
  getBnbConfig,
  getBtcConfig,
  getDaiConfig,
} = require("../Vault/helpers");
const {
  getDefault,
  validateOrderFields,
  getTxFees,
  positionWrapper,
} = require("./helpers");

use(solidity);

const BTC_PRICE = 60000;
const BNB_PRICE = 300;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const PRICE_PRECISION = ethers.BigNumber.from(10).pow(30);
const BASIS_POINTS_DIVISOR = 10000;

describe("OrderBook, increase position orders", function () {
  const provider = waffle.provider;
  const [wallet, user0, user1, user2, user3] = provider.getWallets();

  let orderBook;
  let defaults;
  let tokenDecimals;
  let params;

  beforeEach(async () => {
    bnb = await deployContract("Token", []);
    bnbPriceFeed = await deployContract("PriceFeed", []);

    btc = await deployContract("Token", []);
    btcPriceFeed = await deployContract("PriceFeed", []);

    eth = await deployContract("Token", []);
    ethPriceFeed = await deployContract("PriceFeed", []);

    dai = await deployContract("Token", []);
    daiPriceFeed = await deployContract("PriceFeed", []);

    busd = await deployContract("Token", []);
    busdPriceFeed = await deployContract("PriceFeed", []);

    vault = await deployContract("Vault", []);
    usdg = await deployContract("USDG", [vault.address]);
    router = await deployContract("Router", [
      vault.address,
      usdg.address,
      bnb.address,
    ]);
    vaultPriceFeed = await deployContract("VaultPriceFeed", []);

    const initVaultResult = await initVault(
      vault,
      router,
      usdg,
      vaultPriceFeed
    );

    distributor0 = await deployContract("TimeDistributor", []);
    yieldTracker0 = await deployContract("YieldTracker", [usdg.address]);

    await yieldTracker0.setDistributor(distributor0.address);
    await distributor0.setDistribution(
      [yieldTracker0.address],
      [1000],
      [bnb.address]
    );

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
    await vaultPriceFeed.setPriceSampleSpace(1);

    tokenDecimals = {
      [bnb.address]: 18,
      [dai.address]: 18,
      [btc.address]: 8,
    };

    await daiPriceFeed.setLatestAnswer(toChainlinkPrice(1));
    await vault.setTokenConfig(...getDaiConfig(dai, daiPriceFeed));

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(BTC_PRICE));
    await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed));

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(BNB_PRICE));
    await vault.setTokenConfig(...getBnbConfig(bnb, bnbPriceFeed));

    orderBook = await deployContract("OrderBook", []);
    const minExecutionFee = 500000;
    await orderBook.initialize(
      router.address,
      vault.address,
      bnb.address,
      usdg.address,
      minExecutionFee,
      expandDecimals(5, 30) // minPurchseTokenAmountUsd
    );

    const depositFee = 50;
    positionRouter = await deployContract("PositionRouter", [
      vault.address,
      router.address,
      bnb.address,
      depositFee,
      minExecutionFee,
    ]);
    referralStorage = await deployContract("ReferralStorage", []);
    await positionRouter.setReferralStorage(referralStorage.address);
    await referralStorage.setHandler(positionRouter.address, true);

    complexOrderRouter = await deployContract("ComplexOrderRouter", [
      orderBook.address,
      positionRouter.address,
      bnb.address,
    ]);

    await orderBook.setComplexOrderRouter(complexOrderRouter.address);
    await positionRouter.setComplexOrderRouter(complexOrderRouter.address);

    await router.addPlugin(positionRouter.address);
    await router.connect(user0).approvePlugin(positionRouter.address);

    await router.addPlugin(orderBook.address);
    await router.connect(user0).approvePlugin(orderBook.address);

    await btc.mint(user0.address, expandDecimals(1000, 8));
    await btc.connect(user0).approve(router.address, expandDecimals(100, 8));

    await dai.mint(user0.address, expandDecimals(10000000, 18));
    await dai
      .connect(user0)
      .approve(router.address, expandDecimals(1000000, 18));

    await bnb.mint(user0.address, expandDecimals(10000000, 18));
    await bnb
      .connect(user0)
      .approve(router.address, expandDecimals(1000000, 18));

    await dai.mint(user0.address, expandDecimals(20000000, 18));
    await dai
      .connect(user0)
      .transfer(vault.address, expandDecimals(2000000, 18));
    await vault.directPoolDeposit(dai.address);

    await btc.mint(user0.address, expandDecimals(1000, 8));
    await btc.connect(user0).transfer(vault.address, expandDecimals(100, 8));
    await vault.directPoolDeposit(btc.address);

    await bnb.mint(user0.address, expandDecimals(50000, 18));
    await bnb.connect(user0).transfer(vault.address, expandDecimals(10000, 18));
    await vault.directPoolDeposit(bnb.address);

    defaults = {
      path: [btc.address],
      sizeDelta: toUsd(100000),
      amountIn: expandDecimals(1, 8),
      minOut: 0,
      triggerPrice: toUsd(53000),
      triggerAboveThreshold: true,
      executionFee: expandDecimals(1, 9).mul(1500000),
      collateralToken: btc.address,
      collateralDelta: toUsd(BTC_PRICE),
      user: user0,
      isLong: true,
      shouldWrap: false,
    };

    params = [
      [btc.address], // _path
      expandDecimals(1, 8).div(10), // _amountIn
      0, // _minOut
      true, // _isLong
      btc.address,
      true,
      [toUsd(100000), toUsd(100000), toUsd(100000)], // _sizeDelta
      [toUsd(53000), toUsd(53000), toUsd(53000)], // _price
      [btc.address, btc.address, btc.address], // _token
      [
        expandDecimals(1, 9).mul(1500000),
        expandDecimals(1, 9).mul(1500000),
        expandDecimals(1, 9).mul(1500000),
      ], // _executionFee
    ];
  });

  async function getCreatedIncreaseOrder(address, orderIndex = 0) {
    const order = await orderBook.increaseOrders(address, orderIndex);
    return order;
  }

  it("createIncreaseOrder, two orders", async () => {
    params[6] = [toUsd(40000), toUsd(40000), toUsd(40000)];
    const tx = await complexOrderRouter
      .connect(user0)
      .createComplexLimitOrder(...params, {
        value: expandDecimals(1, 9).mul(1500000).mul(3),
      });
    reportGasUsed(provider, tx, "createComplexLimitOrder gas used");
    params[6] = [toUsd(50000), toUsd(50000), toUsd(50000)];
    const tx2 = await complexOrderRouter
      .connect(user0)
      .createComplexLimitOrder(...params, {
        value: expandDecimals(1, 9).mul(1500000).mul(3),
      });
    reportGasUsed(provider, tx2, "createComplexLimitOrder gas used");

    const order1 = await getCreatedIncreaseOrder(user0.address, 0);
    const order2 = await getCreatedIncreaseOrder(user0.address, 1);

    expect(order1.sizeDelta).to.be.equal(toUsd(40000));
    expect(order2.sizeDelta).to.be.equal(toUsd(50000));
  });

  it("createIncreaseOrder, pay WETH", async () => {
    const bnbBalanceBefore = await bnb.balanceOf(orderBook.address);
    const amountIn = expandDecimals(30, 18);
    const value = defaults.executionFee;
    params[0] = [bnb.address];
    params[1] = amountIn;
    const tx = await complexOrderRouter
      .connect(user0)
      .createComplexLimitOrder(...params, {
        value: expandDecimals(1, 9).mul(1500000).mul(2).add(value),
      });

    reportGasUsed(provider, tx, "createIncreaseOrder gas used");

    const order = await getCreatedIncreaseOrder(user0.address);
    const bnbBalanceAfter = await bnb.balanceOf(orderBook.address);

    const bnbBalanceDiff = bnbBalanceAfter
      .sub(bnbBalanceBefore)
      .sub(expandDecimals(1, 9).mul(1500000).mul(2));
    expect(bnbBalanceDiff, "BNB balance").to.be.equal(
      amountIn.add(defaults.executionFee)
    );

    validateOrderFields(order, {
      account: defaults.user.address,
      purchaseToken: bnb.address,
      purchaseTokenAmount: amountIn,
      indexToken: btc.address,
      sizeDelta: defaults.sizeDelta,
      isLong: true,
      triggerPrice: defaults.triggerPrice,
      triggerAboveThreshold: true,
      executionFee: defaults.executionFee,
    });
  });

  it("createIncreaseOrder, pay BNB", async () => {
    const bnbBalanceBefore = await bnb.balanceOf(orderBook.address);
    const amountIn = expandDecimals(30, 18);
    const value = defaults.executionFee.add(amountIn);

    params = [
      [bnb.address], // _path
      0, // _minOut
      true, // _isLong
      btc.address,
      true,
      [toUsd(100000), toUsd(100000), toUsd(100000)], // _sizeDelta
      [toUsd(53000), toUsd(53000), toUsd(53000)], // _price
      [btc.address, btc.address, btc.address], // _token
      [
        expandDecimals(1, 9).mul(1500000),
        expandDecimals(1, 9).mul(1500000),
        expandDecimals(1, 9).mul(1500000),
      ], // _executionFee
    ];
    const tx = await complexOrderRouter
      .connect(user0)
      .createComplexLimitOrderETH(...params, {
        value: expandDecimals(1, 9).mul(1500000).mul(2).add(value),
      });

    reportGasUsed(provider, tx, "createIncreaseOrder gas used");

    const order = await getCreatedIncreaseOrder(user0.address);
    const bnbBalanceAfter = await bnb.balanceOf(orderBook.address);

    const bnbBalanceDiff = bnbBalanceAfter
      .sub(bnbBalanceBefore)
      .sub(expandDecimals(1, 9).mul(1500000).mul(2));
    expect(bnbBalanceDiff, "BNB balance").to.be.equal(
      amountIn.add(defaults.executionFee)
    );

    validateOrderFields(order, {
      account: defaults.user.address,
      purchaseToken: bnb.address,
      purchaseTokenAmount: amountIn,
      indexToken: btc.address,
      sizeDelta: defaults.sizeDelta,
      isLong: true,
      triggerPrice: defaults.triggerPrice,
      triggerAboveThreshold: true,
      executionFee: defaults.executionFee,
    });
  });

  it("createIncreaseOrder, long A, transfer and purchase A", async () => {
    const btcBalanceBefore = await btc.balanceOf(orderBook.address);
    const tx = await complexOrderRouter
      .connect(user0)
      .createComplexLimitOrder(...params, {
        value: expandDecimals(1, 9).mul(1500000).mul(3),
      });
    reportGasUsed(provider, tx, "createIncreaseOrder gas used");

    const order = await getCreatedIncreaseOrder(user0.address);
    const btcBalanceAfter = await btc.balanceOf(orderBook.address);

    expect(await bnb.balanceOf(orderBook.address), "BNB balance").to.be.equal(
      expandDecimals(1, 9).mul(1500000).mul(3)
    );
    expect(btcBalanceAfter.sub(btcBalanceBefore), "BTC balance").to.be.equal(
      expandDecimals(1, 8).div(10)
    );

    validateOrderFields(order, {
      account: defaults.user.address,
      purchaseToken: btc.address,
      purchaseTokenAmount: expandDecimals(1, 8).div(10),
      indexToken: btc.address,
      sizeDelta: defaults.sizeDelta,
      isLong: true,
      triggerPrice: defaults.triggerPrice,
      triggerAboveThreshold: true,
      executionFee: defaults.executionFee,
    });
  });

  it("createIncreaseOrder, bad path", async () => {
    params[0] = [btc.address, btc.address];
    await expect(
      complexOrderRouter.connect(user0).createComplexLimitOrder(...params, {
        value: expandDecimals(1, 9).mul(1500000).mul(3),
      })
    ).to.be.revertedWith("OrderBook: invalid _path");
  });
});
