const { expect, use } = require("chai");
const { solidity } = require("ethereum-waffle");
const { deployContract } = require("../../shared/fixtures");
const {
  expandDecimals,
  reportGasUsed,
  gasUsed,
} = require("../../shared/utilities");
const { toChainlinkPrice } = require("../../shared/chainlink");
const { toUsd } = require("../../shared/units");
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

describe("OrderBook, decrease position orders", () => {
  const provider = waffle.provider;
  const [wallet, user0, user1, user2, user3] = provider.getWallets();

  let vault;
  let orderBook;
  let defaults;
  let tokenDecimals;
  let params;

  let usdg;
  let router;
  let bnb;
  let bnbPriceFeed;
  let btc;
  let btcPriceFeed;
  let dai;
  let daiPriceFeed;
  let vaultPriceFeed;
  let complexOrderRouter;

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

    await router.addPlugin(orderBook.address);
    await router.connect(user0).approvePlugin(orderBook.address);
    await router.addPlugin(positionRouter.address);
    await router.connect(user0).approvePlugin(positionRouter.address);

    await btc.mint(user0.address, expandDecimals(1000, 8));
    await btc.connect(user0).approve(router.address, expandDecimals(100, 8));

    await dai.mint(user0.address, expandDecimals(10000000, 18));
    await dai
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
    };

    const referralCode =
      "0x0000000000000000000000000000000000000000000000000000000000000123";
    params = [
      [btc.address], // _path
      expandDecimals(1, 8), // _amountIn
      0, // _minOut
      true, // _isLong
      referralCode,
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

  async function getCreatedDecreaseOrder(address, orderIndex = 0) {
    const order = await orderBook.decreaseOrders(address, orderIndex);
    return order;
  }

  it("Create decrease order, long", async () => {
    const tx = await complexOrderRouter
      .connect(user0)
      .createComplexOrder(...params, {
        value: expandDecimals(1, 9).mul(1500000).mul(3),
      });
    reportGasUsed(provider, tx, "createDecraseOrder gas used");
    let order = await getCreatedDecreaseOrder(defaults.user.address, 0);
    let order2 = await getCreatedDecreaseOrder(defaults.user.address, 1);
    const btcBalanceAfter = await btc.balanceOf(orderBook.address);

    expect(await bnb.balanceOf(orderBook.address), "BNB balance").to.be.equal(
      defaults.executionFee * 2
    );

    validateOrderFields(order, {
      account: defaults.user.address,
      indexToken: btc.address,
      sizeDelta: defaults.sizeDelta,
      collateralToken: defaults.collateralToken,
      collateralDelta: 0,
      isLong: true,
      triggerPrice: defaults.triggerPrice,
      triggerAboveThreshold: true,
      executionFee: defaults.executionFee,
    });
    validateOrderFields(order2, {
      account: defaults.user.address,
      indexToken: btc.address,
      sizeDelta: defaults.sizeDelta,
      collateralToken: defaults.collateralToken,
      collateralDelta: 0,
      isLong: true,
      triggerPrice: defaults.triggerPrice,
      triggerAboveThreshold: true,
      executionFee: defaults.executionFee,
    });
  });

  it("Create decrease order, short", async () => {
    params[3] = false;
    const tx = await complexOrderRouter
      .connect(user0)
      .createComplexOrder(...params, {
        value: expandDecimals(1, 9).mul(1500000).mul(3),
      });
    reportGasUsed(provider, tx, "createDecreaseOrder gas used");
    const order = await getCreatedDecreaseOrder(defaults.user.address, 0);
    const order2 = await getCreatedDecreaseOrder(defaults.user.address, 1);
    const btcBalanceAfter = await btc.balanceOf(orderBook.address);

    expect(await bnb.balanceOf(orderBook.address), "BNB balance").to.be.equal(
      defaults.executionFee * 2
    );

    validateOrderFields(order, {
      account: defaults.user.address,
      indexToken: btc.address,
      sizeDelta: defaults.sizeDelta,
      collateralToken: defaults.collateralToken,
      collateralDelta: 0,
      isLong: false,
      triggerPrice: defaults.triggerPrice,
      triggerAboveThreshold: true,
      executionFee: defaults.executionFee,
    });

    validateOrderFields(order2, {
      account: defaults.user.address,
      indexToken: btc.address,
      sizeDelta: defaults.sizeDelta,
      collateralToken: defaults.collateralToken,
      collateralDelta: 0,
      isLong: false,
      triggerPrice: defaults.triggerPrice,
      triggerAboveThreshold: true,
      executionFee: defaults.executionFee,
    });
  });

  it("Cancel decrease order", async () => {
    await complexOrderRouter.connect(user0).createComplexOrder(...params, {
      value: expandDecimals(1, 9).mul(1500000).mul(3),
    });
    let order = await getCreatedDecreaseOrder(defaults.user.address, 0);
    let order2 = await getCreatedDecreaseOrder(defaults.user.address, 1);
    expect(order.account).to.not.be.equal(ZERO_ADDRESS);
    expect(order2.account).to.not.be.equal(ZERO_ADDRESS);

    await expect(
      orderBook.connect(defaults.user).cancelDecreaseOrder(2)
    ).to.be.revertedWith("OrderBook: non-existent order");

    const balanceBefore = await defaults.user.getBalance();
    const tx = await orderBook.connect(defaults.user).cancelDecreaseOrder(0);
    const tx2 = await orderBook.connect(defaults.user).cancelDecreaseOrder(1);
    reportGasUsed(provider, tx, "cancelDecreaseOrder gas used");
    reportGasUsed(provider, tx2, "cancelDecreaseOrder gas used");

    order = await getCreatedDecreaseOrder(defaults.user.address);
    expect(order.account).to.be.equal(ZERO_ADDRESS);

    const txFees = await getTxFees(provider, tx);
    const txFees2 = await getTxFees(provider, tx2);
    const balanceAfter = await defaults.user.getBalance();
    expect(balanceAfter).to.be.equal(
      balanceBefore
        .add(defaults.executionFee)
        .add(defaults.executionFee)
        .sub(txFees)
        .sub(txFees2)
    );
  });
});
