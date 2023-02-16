const { expect, use } = require("chai");
const { solidity } = require("ethereum-waffle");
const { deployContract } = require("../shared/fixtures");
const {
  expandDecimals,
  getBlockTime,
  increaseTime,
  mineBlock,
  reportGasUsed,
  print,
  newWallet,
} = require("../shared/utilities");
const { toChainlinkPrice } = require("../shared/chainlink");
const { toUsd, toNormalizedPrice } = require("../shared/units");
const {
  initVault,
  getBnbConfig,
  getBtcConfig,
  getDaiConfig,
} = require("../core/Vault/helpers");
const { ADDRESS_ZERO } = require("@uniswap/v3-sdk");

use(solidity);

describe("RewardRouter", function () {
  const provider = waffle.provider;
  const [wallet, user0, user1, user2, user3, user4, tokenManager] =
    provider.getWallets();

  const vestingDuration = 365 * 24 * 60 * 60;

  let timelock;
  let rewardManager;

  let vault;
  let klpManager;
  let klp;
  let usdg;
  let router;
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

  let ktx;
  let esKtx;
  let bnKtx;

  let stakedKtxTracker;
  let stakedKtxDistributor;
  let bonusKtxTracker;
  let bonusKtxDistributor;
  let feeKtxTracker;
  let feeKtxDistributor;

  let feeKlpTracker;
  let feeKlpDistributor;
  let stakedKlpTracker;
  let stakedKlpDistributor;

  let ktxVester;
  let klpVester;

  let rewardRouter;

  beforeEach(async () => {
    rewardManager = await deployContract("RewardManager", []);

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
    klp = await deployContract("KLP", []);

    await initVault(vault, router, usdg, vaultPriceFeed);
    let shortsTracker = await await deployContract(
      "ShortsTracker",
      [vault.address],
      "ShortsTracker"
    );
    klpManager = await deployContract("KlpManager", [
      vault.address,
      usdg.address,
      klp.address,
      shortsTracker.address,
      24 * 60 * 60,
    ]);

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

    await klp.setInPrivateTransferMode(true);
    await klp.setMinter(klpManager.address, true);
    await klpManager.setInPrivateMode(true);

    ktx = await deployContract("KTX", []);
    esKtx = await deployContract("EsKTX", []);
    bnKtx = await deployContract("MintableBaseToken", [
      "Bonus KTX",
      "bnKTX",
      0,
    ]);

    // KTX
    stakedKtxTracker = await deployContract("RewardTracker", [
      "Staked KTX",
      "sKTX",
    ]);
    stakedKtxDistributor = await deployContract("RewardDistributor", [
      esKtx.address,
      stakedKtxTracker.address,
    ]);
    await stakedKtxTracker.initialize(
      [ktx.address, esKtx.address],
      stakedKtxDistributor.address
    );
    await stakedKtxDistributor.updateLastDistributionTime();

    bonusKtxTracker = await deployContract("RewardTracker", [
      "Staked + Bonus KTX",
      "sbKTX",
    ]);
    bonusKtxDistributor = await deployContract("BonusDistributor", [
      bnKtx.address,
      bonusKtxTracker.address,
    ]);
    await bonusKtxTracker.initialize(
      [stakedKtxTracker.address],
      bonusKtxDistributor.address
    );
    await bonusKtxDistributor.updateLastDistributionTime();

    feeKtxTracker = await deployContract("RewardTracker", [
      "Staked + Bonus + Fee KTX",
      "sbfKTX",
    ]);
    feeKtxDistributor = await deployContract("RewardDistributor", [
      eth.address,
      feeKtxTracker.address,
    ]);
    await feeKtxTracker.initialize(
      [bonusKtxTracker.address, bnKtx.address],
      feeKtxDistributor.address
    );
    await feeKtxDistributor.updateLastDistributionTime();

    // KLP
    feeKlpTracker = await deployContract("RewardTracker", ["Fee KLP", "fKLP"]);
    feeKlpDistributor = await deployContract("RewardDistributor", [
      eth.address,
      feeKlpTracker.address,
    ]);
    await feeKlpTracker.initialize([klp.address], feeKlpDistributor.address);
    await feeKlpDistributor.updateLastDistributionTime();

    stakedKlpTracker = await deployContract("RewardTracker", [
      "Fee + Staked KLP",
      "fsKLP",
    ]);
    stakedKlpDistributor = await deployContract("RewardDistributor", [
      esKtx.address,
      stakedKlpTracker.address,
    ]);
    await stakedKlpTracker.initialize(
      [feeKlpTracker.address],
      stakedKlpDistributor.address
    );
    await stakedKlpDistributor.updateLastDistributionTime();

    ktxVester = await deployContract("Vester", [
      "Vested KTX", // _name
      "vKTX", // _symbol
      vestingDuration, // _vestingDuration
      esKtx.address, // _esToken
      feeKtxTracker.address, // _pairToken
      ktx.address, // _claimableToken
      stakedKtxTracker.address, // _rewardTracker
    ]);

    klpVester = await deployContract("Vester", [
      "Vested KLP", // _name
      "vKLP", // _symbol
      vestingDuration, // _vestingDuration
      esKtx.address, // _esToken
      stakedKlpTracker.address, // _pairToken
      ktx.address, // _claimableToken
      stakedKlpTracker.address, // _rewardTracker
    ]);

    await stakedKtxTracker.setInPrivateTransferMode(true);
    await stakedKtxTracker.setInPrivateStakingMode(true);
    await bonusKtxTracker.setInPrivateTransferMode(true);
    await bonusKtxTracker.setInPrivateStakingMode(true);
    await bonusKtxTracker.setInPrivateClaimingMode(true);
    await feeKtxTracker.setInPrivateTransferMode(true);
    await feeKtxTracker.setInPrivateStakingMode(true);

    await feeKlpTracker.setInPrivateTransferMode(true);
    await feeKlpTracker.setInPrivateStakingMode(true);
    await stakedKlpTracker.setInPrivateTransferMode(true);
    await stakedKlpTracker.setInPrivateStakingMode(true);

    await esKtx.setInPrivateTransferMode(true);

    rewardRouter = await deployContract("RewardRouter", []);
    await rewardRouter.initialize(
      bnb.address,
      ktx.address,
      esKtx.address,
      bnKtx.address,
      klp.address,
      stakedKtxTracker.address,
      bonusKtxTracker.address,
      feeKtxTracker.address,
      feeKlpTracker.address,
      stakedKlpTracker.address,
      klpManager.address,
      ktxVester.address,
      klpVester.address
    );
    timelock = await deployContract("Timelock", [
      wallet.address,
      10,
      tokenManager.address,
      tokenManager.address,
      tokenManager.address,
      rewardRouter.address,
      rewardManager.address,
      expandDecimals(1000000, 18),
      10,
      100,
    ]);

    await rewardManager.initialize(
      timelock.address,
      rewardRouter.address,
      klpManager.address,
      stakedKtxTracker.address,
      bonusKtxTracker.address,
      feeKtxTracker.address,
      feeKlpTracker.address,
      stakedKlpTracker.address,
      stakedKtxDistributor.address,
      stakedKlpDistributor.address,
      esKtx.address,
      bnKtx.address,
      ktxVester.address,
      klpVester.address
    );

    // allow bonusKtxTracker to stake stakedKtxTracker
    await stakedKtxTracker.setHandler(bonusKtxTracker.address, true);
    // allow bonusKtxTracker to stake feeKtxTracker
    await bonusKtxTracker.setHandler(feeKtxTracker.address, true);
    await bonusKtxDistributor.setBonusMultiplier(10000);
    // allow feeKtxTracker to stake bnKtx
    await bnKtx.setHandler(feeKtxTracker.address, true);

    // allow stakedKlpTracker to stake feeKlpTracker
    await feeKlpTracker.setHandler(stakedKlpTracker.address, true);
    // allow feeKlpTracker to stake klp
    await klp.setHandler(feeKlpTracker.address, true);

    // mint esKtx for distributors
    await esKtx.setMinter(wallet.address, true);
    await esKtx.mint(stakedKtxDistributor.address, expandDecimals(50000, 18));
    await stakedKtxDistributor.setTokensPerInterval("20667989410000000"); // 0.02066798941 esKtx per second
    await esKtx.mint(stakedKlpDistributor.address, expandDecimals(50000, 18));
    await stakedKlpDistributor.setTokensPerInterval("20667989410000000"); // 0.02066798941 esKtx per second

    // mint bnKtx for distributor
    await bnKtx.setMinter(wallet.address, true);
    await bnKtx.mint(bonusKtxDistributor.address, expandDecimals(1500, 18));

    await esKtx.setHandler(tokenManager.address, true);
    await ktxVester.setHandler(wallet.address, true);

    await klpManager.setGov(timelock.address);
    await stakedKtxTracker.setGov(timelock.address);
    await bonusKtxTracker.setGov(timelock.address);
    await feeKtxTracker.setGov(timelock.address);
    await feeKlpTracker.setGov(timelock.address);
    await stakedKlpTracker.setGov(timelock.address);
    await stakedKtxDistributor.setGov(timelock.address);
    await stakedKlpDistributor.setGov(timelock.address);
    await esKtx.setGov(timelock.address);
    await bnKtx.setGov(timelock.address);
    await ktxVester.setGov(timelock.address);
    await klpVester.setGov(timelock.address);

    await rewardManager.updateEsKtxHandlers();
    await rewardManager.enableRewardRouter();
  });

  it("inits", async () => {
    expect(await rewardRouter.isInitialized()).eq(true);

    expect(await rewardRouter.weth()).eq(bnb.address);
    expect(await rewardRouter.ktx()).eq(ktx.address);
    expect(await rewardRouter.esKtx()).eq(esKtx.address);
    expect(await rewardRouter.bnKtx()).eq(bnKtx.address);

    expect(await rewardRouter.klp()).eq(klp.address);

    expect(await rewardRouter.stakedKtxTracker()).eq(stakedKtxTracker.address);
    expect(await rewardRouter.bonusKtxTracker()).eq(bonusKtxTracker.address);
    expect(await rewardRouter.feeKtxTracker()).eq(feeKtxTracker.address);

    expect(await rewardRouter.feeKlpTracker()).eq(feeKlpTracker.address);
    expect(await rewardRouter.stakedKlpTracker()).eq(stakedKlpTracker.address);

    expect(await rewardRouter.klpManager()).eq(klpManager.address);

    expect(await rewardRouter.ktxVester()).eq(ktxVester.address);
    expect(await rewardRouter.klpVester()).eq(klpVester.address);

    await expect(
      rewardRouter.initialize(
        bnb.address,
        ktx.address,
        esKtx.address,
        bnKtx.address,
        klp.address,
        stakedKtxTracker.address,
        bonusKtxTracker.address,
        feeKtxTracker.address,
        feeKlpTracker.address,
        stakedKlpTracker.address,
        klpManager.address,
        ktxVester.address,
        klpVester.address
      )
    ).to.be.revertedWith("RewardRouter: already initialized");

    expect(await rewardManager.timelock()).eq(timelock.address);
    expect(await rewardManager.rewardRouter()).eq(rewardRouter.address);
    expect(await rewardManager.klpManager()).eq(klpManager.address);
    expect(await rewardManager.stakedKtxTracker()).eq(stakedKtxTracker.address);
    expect(await rewardManager.bonusKtxTracker()).eq(bonusKtxTracker.address);
    expect(await rewardManager.feeKtxTracker()).eq(feeKtxTracker.address);
    expect(await rewardManager.feeKlpTracker()).eq(feeKlpTracker.address);
    expect(await rewardManager.stakedKlpTracker()).eq(stakedKlpTracker.address);
    expect(await rewardManager.stakedKtxTracker()).eq(stakedKtxTracker.address);
    expect(await rewardManager.stakedKtxDistributor()).eq(
      stakedKtxDistributor.address
    );
    expect(await rewardManager.stakedKlpDistributor()).eq(
      stakedKlpDistributor.address
    );
    expect(await rewardManager.esKtx()).eq(esKtx.address);
    expect(await rewardManager.bnKtx()).eq(bnKtx.address);
    expect(await rewardManager.ktxVester()).eq(ktxVester.address);
    expect(await rewardManager.klpVester()).eq(klpVester.address);

    await expect(
      rewardManager.initialize(
        timelock.address,
        rewardRouter.address,
        klpManager.address,
        stakedKtxTracker.address,
        bonusKtxTracker.address,
        feeKtxTracker.address,
        feeKlpTracker.address,
        stakedKlpTracker.address,
        stakedKtxDistributor.address,
        stakedKlpDistributor.address,
        esKtx.address,
        bnKtx.address,
        ktxVester.address,
        klpVester.address
      )
    ).to.be.revertedWith("RewardManager: already initialized");
  });

  it("stakeKtxForAccount, stakeKtx, stakeEsKtx, unstakeKtx, unstakeEsKtx, claimEsKtx, claimFees, compound, batchCompoundForAccounts", async () => {
    await eth.mint(feeKtxDistributor.address, expandDecimals(100, 18));
    await feeKtxDistributor.setTokensPerInterval("41335970000000"); // 0.00004133597 ETH per second

    await ktx.setMinter(wallet.address, true);
    await ktx.mint(user0.address, expandDecimals(1500, 18));
    expect(await ktx.balanceOf(user0.address)).eq(expandDecimals(1500, 18));

    await ktx
      .connect(user0)
      .approve(stakedKtxTracker.address, expandDecimals(1000, 18));
    await expect(
      rewardRouter
        .connect(user0)
        .stakeKtxForAccount(user1.address, expandDecimals(1000, 18))
    ).to.be.revertedWith("Governable: forbidden");

    await rewardRouter.setGov(user0.address);
    await rewardRouter
      .connect(user0)
      .stakeKtxForAccount(user1.address, expandDecimals(800, 18));
    expect(await ktx.balanceOf(user0.address)).eq(expandDecimals(700, 18));

    await ktx.mint(user1.address, expandDecimals(200, 18));
    expect(await ktx.balanceOf(user1.address)).eq(expandDecimals(200, 18));
    await ktx
      .connect(user1)
      .approve(stakedKtxTracker.address, expandDecimals(200, 18));
    await rewardRouter.connect(user1).stakeKtx(expandDecimals(200, 18));
    expect(await ktx.balanceOf(user1.address)).eq(0);

    expect(await stakedKtxTracker.stakedAmounts(user0.address)).eq(0);
    expect(
      await stakedKtxTracker.depositBalances(user0.address, ktx.address)
    ).eq(0);
    expect(await stakedKtxTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(1000, 18)
    );
    expect(
      await stakedKtxTracker.depositBalances(user1.address, ktx.address)
    ).eq(expandDecimals(1000, 18));

    expect(await bonusKtxTracker.stakedAmounts(user0.address)).eq(0);
    expect(
      await bonusKtxTracker.depositBalances(
        user0.address,
        stakedKtxTracker.address
      )
    ).eq(0);
    expect(await bonusKtxTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(1000, 18)
    );
    expect(
      await bonusKtxTracker.depositBalances(
        user1.address,
        stakedKtxTracker.address
      )
    ).eq(expandDecimals(1000, 18));

    expect(await feeKtxTracker.stakedAmounts(user0.address)).eq(0);
    expect(
      await feeKtxTracker.depositBalances(
        user0.address,
        bonusKtxTracker.address
      )
    ).eq(0);
    expect(await feeKtxTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(1000, 18)
    );
    expect(
      await feeKtxTracker.depositBalances(
        user1.address,
        bonusKtxTracker.address
      )
    ).eq(expandDecimals(1000, 18));

    await increaseTime(provider, 24 * 60 * 60);
    await mineBlock(provider);

    expect(await stakedKtxTracker.claimable(user0.address)).eq(0);
    expect(await stakedKtxTracker.claimable(user1.address)).gt(
      expandDecimals(1785, 18)
    ); // 50000 / 28 => ~1785
    expect(await stakedKtxTracker.claimable(user1.address)).lt(
      expandDecimals(1786, 18)
    );

    expect(await bonusKtxTracker.claimable(user0.address)).eq(0);
    expect(await bonusKtxTracker.claimable(user1.address)).gt(
      "2730000000000000000"
    ); // 2.73, 1000 / 365 => ~2.74
    expect(await bonusKtxTracker.claimable(user1.address)).lt(
      "2750000000000000000"
    ); // 2.75

    expect(await feeKtxTracker.claimable(user0.address)).eq(0);
    expect(await feeKtxTracker.claimable(user1.address)).gt(
      "3560000000000000000"
    ); // 3.56, 100 / 28 => ~3.57
    expect(await feeKtxTracker.claimable(user1.address)).lt(
      "3580000000000000000"
    ); // 3.58

    await timelock.mint(esKtx.address, expandDecimals(500, 18));
    await esKtx
      .connect(tokenManager)
      .transferFrom(
        tokenManager.address,
        user2.address,
        expandDecimals(500, 18)
      );
    await rewardRouter.connect(user2).stakeEsKtx(expandDecimals(500, 18));

    expect(await stakedKtxTracker.stakedAmounts(user0.address)).eq(0);
    expect(
      await stakedKtxTracker.depositBalances(user0.address, ktx.address)
    ).eq(0);
    expect(await stakedKtxTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(1000, 18)
    );
    expect(
      await stakedKtxTracker.depositBalances(user1.address, ktx.address)
    ).eq(expandDecimals(1000, 18));
    expect(await stakedKtxTracker.stakedAmounts(user2.address)).eq(
      expandDecimals(500, 18)
    );
    expect(
      await stakedKtxTracker.depositBalances(user2.address, esKtx.address)
    ).eq(expandDecimals(500, 18));

    expect(await bonusKtxTracker.stakedAmounts(user0.address)).eq(0);
    expect(
      await bonusKtxTracker.depositBalances(
        user0.address,
        stakedKtxTracker.address
      )
    ).eq(0);
    expect(await bonusKtxTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(1000, 18)
    );
    expect(
      await bonusKtxTracker.depositBalances(
        user1.address,
        stakedKtxTracker.address
      )
    ).eq(expandDecimals(1000, 18));
    expect(await bonusKtxTracker.stakedAmounts(user2.address)).eq(
      expandDecimals(500, 18)
    );
    expect(
      await bonusKtxTracker.depositBalances(
        user2.address,
        stakedKtxTracker.address
      )
    ).eq(expandDecimals(500, 18));

    expect(await feeKtxTracker.stakedAmounts(user0.address)).eq(0);
    expect(
      await feeKtxTracker.depositBalances(
        user0.address,
        bonusKtxTracker.address
      )
    ).eq(0);
    expect(await feeKtxTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(1000, 18)
    );
    expect(
      await feeKtxTracker.depositBalances(
        user1.address,
        bonusKtxTracker.address
      )
    ).eq(expandDecimals(1000, 18));
    expect(await feeKtxTracker.stakedAmounts(user2.address)).eq(
      expandDecimals(500, 18)
    );
    expect(
      await feeKtxTracker.depositBalances(
        user2.address,
        bonusKtxTracker.address
      )
    ).eq(expandDecimals(500, 18));

    await increaseTime(provider, 24 * 60 * 60);
    await mineBlock(provider);

    expect(await stakedKtxTracker.claimable(user0.address)).eq(0);
    expect(await stakedKtxTracker.claimable(user1.address)).gt(
      expandDecimals(1785 + 1190, 18)
    );
    expect(await stakedKtxTracker.claimable(user1.address)).lt(
      expandDecimals(1786 + 1191, 18)
    );
    expect(await stakedKtxTracker.claimable(user2.address)).gt(
      expandDecimals(595, 18)
    );
    expect(await stakedKtxTracker.claimable(user2.address)).lt(
      expandDecimals(596, 18)
    );

    expect(await bonusKtxTracker.claimable(user0.address)).eq(0);
    expect(await bonusKtxTracker.claimable(user1.address)).gt(
      "5470000000000000000"
    ); // 5.47, 1000 / 365 * 2 => ~5.48
    expect(await bonusKtxTracker.claimable(user1.address)).lt(
      "5490000000000000000"
    );
    expect(await bonusKtxTracker.claimable(user2.address)).gt(
      "1360000000000000000"
    ); // 1.36, 500 / 365 => ~1.37
    expect(await bonusKtxTracker.claimable(user2.address)).lt(
      "1380000000000000000"
    );

    expect(await feeKtxTracker.claimable(user0.address)).eq(0);
    expect(await feeKtxTracker.claimable(user1.address)).gt(
      "5940000000000000000"
    ); // 5.94, 3.57 + 100 / 28 / 3 * 2 => ~5.95
    expect(await feeKtxTracker.claimable(user1.address)).lt(
      "5960000000000000000"
    );
    expect(await feeKtxTracker.claimable(user2.address)).gt(
      "1180000000000000000"
    ); // 1.18, 100 / 28 / 3 => ~1.19
    expect(await feeKtxTracker.claimable(user2.address)).lt(
      "1200000000000000000"
    );

    expect(await esKtx.balanceOf(user1.address)).eq(0);
    await rewardRouter.connect(user1).claimEsKtx();
    expect(await esKtx.balanceOf(user1.address)).gt(
      expandDecimals(1785 + 1190, 18)
    );
    expect(await esKtx.balanceOf(user1.address)).lt(
      expandDecimals(1786 + 1191, 18)
    );

    expect(await eth.balanceOf(user1.address)).eq(0);
    await rewardRouter.connect(user1).claimFees();
    expect(await eth.balanceOf(user1.address)).gt("5940000000000000000");
    expect(await eth.balanceOf(user1.address)).lt("5960000000000000000");

    expect(await esKtx.balanceOf(user2.address)).eq(0);
    await rewardRouter.connect(user2).claimEsKtx();
    expect(await esKtx.balanceOf(user2.address)).gt(expandDecimals(595, 18));
    expect(await esKtx.balanceOf(user2.address)).lt(expandDecimals(596, 18));

    expect(await eth.balanceOf(user2.address)).eq(0);
    await rewardRouter.connect(user2).claimFees();
    expect(await eth.balanceOf(user2.address)).gt("1180000000000000000");
    expect(await eth.balanceOf(user2.address)).lt("1200000000000000000");

    await increaseTime(provider, 24 * 60 * 60);
    await mineBlock(provider);

    const tx0 = await rewardRouter.connect(user1).compound();
    await reportGasUsed(provider, tx0, "compound gas used");

    await increaseTime(provider, 24 * 60 * 60);
    await mineBlock(provider);

    const tx1 = await rewardRouter
      .connect(user0)
      .batchCompoundForAccounts([user1.address, user2.address]);
    await reportGasUsed(provider, tx1, "batchCompoundForAccounts gas used");

    expect(await stakedKtxTracker.stakedAmounts(user1.address)).gt(
      expandDecimals(3643, 18)
    );
    expect(await stakedKtxTracker.stakedAmounts(user1.address)).lt(
      expandDecimals(3645, 18)
    );
    expect(
      await stakedKtxTracker.depositBalances(user1.address, ktx.address)
    ).eq(expandDecimals(1000, 18));
    expect(
      await stakedKtxTracker.depositBalances(user1.address, esKtx.address)
    ).gt(expandDecimals(2643, 18));
    expect(
      await stakedKtxTracker.depositBalances(user1.address, esKtx.address)
    ).lt(expandDecimals(2645, 18));

    expect(await bonusKtxTracker.stakedAmounts(user1.address)).gt(
      expandDecimals(3643, 18)
    );
    expect(await bonusKtxTracker.stakedAmounts(user1.address)).lt(
      expandDecimals(3645, 18)
    );

    expect(await feeKtxTracker.stakedAmounts(user1.address)).gt(
      expandDecimals(3657, 18)
    );
    expect(await feeKtxTracker.stakedAmounts(user1.address)).lt(
      expandDecimals(3659, 18)
    );
    expect(
      await feeKtxTracker.depositBalances(
        user1.address,
        bonusKtxTracker.address
      )
    ).gt(expandDecimals(3643, 18));
    expect(
      await feeKtxTracker.depositBalances(
        user1.address,
        bonusKtxTracker.address
      )
    ).lt(expandDecimals(3645, 18));
    expect(
      await feeKtxTracker.depositBalances(user1.address, bnKtx.address)
    ).gt("14100000000000000000"); // 14.1
    expect(
      await feeKtxTracker.depositBalances(user1.address, bnKtx.address)
    ).lt("14300000000000000000"); // 14.3

    expect(await ktx.balanceOf(user1.address)).eq(0);
    await rewardRouter.connect(user1).unstakeKtx(expandDecimals(300, 18));
    expect(await ktx.balanceOf(user1.address)).eq(expandDecimals(300, 18));

    expect(await stakedKtxTracker.stakedAmounts(user1.address)).gt(
      expandDecimals(3343, 18)
    );
    expect(await stakedKtxTracker.stakedAmounts(user1.address)).lt(
      expandDecimals(3345, 18)
    );
    expect(
      await stakedKtxTracker.depositBalances(user1.address, ktx.address)
    ).eq(expandDecimals(700, 18));
    expect(
      await stakedKtxTracker.depositBalances(user1.address, esKtx.address)
    ).gt(expandDecimals(2643, 18));
    expect(
      await stakedKtxTracker.depositBalances(user1.address, esKtx.address)
    ).lt(expandDecimals(2645, 18));

    expect(await bonusKtxTracker.stakedAmounts(user1.address)).gt(
      expandDecimals(3343, 18)
    );
    expect(await bonusKtxTracker.stakedAmounts(user1.address)).lt(
      expandDecimals(3345, 18)
    );

    expect(await feeKtxTracker.stakedAmounts(user1.address)).gt(
      expandDecimals(3357, 18)
    );
    expect(await feeKtxTracker.stakedAmounts(user1.address)).lt(
      expandDecimals(3359, 18)
    );
    expect(
      await feeKtxTracker.depositBalances(
        user1.address,
        bonusKtxTracker.address
      )
    ).gt(expandDecimals(3343, 18));
    expect(
      await feeKtxTracker.depositBalances(
        user1.address,
        bonusKtxTracker.address
      )
    ).lt(expandDecimals(3345, 18));
    expect(
      await feeKtxTracker.depositBalances(user1.address, bnKtx.address)
    ).gt("13000000000000000000"); // 13
    expect(
      await feeKtxTracker.depositBalances(user1.address, bnKtx.address)
    ).lt("13100000000000000000"); // 13.1

    const esKtxBalance1 = await esKtx.balanceOf(user1.address);
    const esKtxUnstakeBalance1 = await stakedKtxTracker.depositBalances(
      user1.address,
      esKtx.address
    );
    await rewardRouter.connect(user1).unstakeEsKtx(esKtxUnstakeBalance1);
    expect(await esKtx.balanceOf(user1.address)).eq(
      esKtxBalance1.add(esKtxUnstakeBalance1)
    );

    expect(await stakedKtxTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(700, 18)
    );
    expect(
      await stakedKtxTracker.depositBalances(user1.address, ktx.address)
    ).eq(expandDecimals(700, 18));
    expect(
      await stakedKtxTracker.depositBalances(user1.address, esKtx.address)
    ).eq(0);

    expect(await bonusKtxTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(700, 18)
    );

    expect(await feeKtxTracker.stakedAmounts(user1.address)).gt(
      expandDecimals(702, 18)
    );
    expect(await feeKtxTracker.stakedAmounts(user1.address)).lt(
      expandDecimals(703, 18)
    );
    expect(
      await feeKtxTracker.depositBalances(
        user1.address,
        bonusKtxTracker.address
      )
    ).eq(expandDecimals(700, 18));
    expect(
      await feeKtxTracker.depositBalances(user1.address, bnKtx.address)
    ).gt("2720000000000000000"); // 2.72
    expect(
      await feeKtxTracker.depositBalances(user1.address, bnKtx.address)
    ).lt("2740000000000000000"); // 2.74

    await expect(
      rewardRouter.connect(user1).unstakeEsKtx(expandDecimals(1, 18))
    ).to.be.revertedWith("RewardTracker: _amount exceeds depositBalance");
  });

  it("mintAndStakeKlp, unstakeAndRedeemKlp, compound, batchCompoundForAccounts", async () => {
    await eth.mint(feeKlpDistributor.address, expandDecimals(100, 18));
    await feeKlpDistributor.setTokensPerInterval("41335970000000"); // 0.00004133597 ETH per second

    await bnb.mint(user1.address, expandDecimals(1, 18));
    await bnb.connect(user1).approve(klpManager.address, expandDecimals(1, 18));
    const tx0 = await rewardRouter
      .connect(user1)
      .mintAndStakeKlp(
        bnb.address,
        expandDecimals(1, 18),
        expandDecimals(299, 18),
        expandDecimals(299, 18)
      );
    await reportGasUsed(provider, tx0, "mintAndStakeKlp gas used");

    expect(await feeKlpTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(2991, 17)
    );
    expect(await feeKlpTracker.depositBalances(user1.address, klp.address)).eq(
      expandDecimals(2991, 17)
    );

    expect(await stakedKlpTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(2991, 17)
    );
    expect(
      await stakedKlpTracker.depositBalances(
        user1.address,
        feeKlpTracker.address
      )
    ).eq(expandDecimals(2991, 17));

    await bnb.mint(user1.address, expandDecimals(2, 18));
    await bnb.connect(user1).approve(klpManager.address, expandDecimals(2, 18));
    await rewardRouter
      .connect(user1)
      .mintAndStakeKlp(
        bnb.address,
        expandDecimals(2, 18),
        expandDecimals(299, 18),
        expandDecimals(299, 18)
      );

    await increaseTime(provider, 24 * 60 * 60 + 1);
    await mineBlock(provider);

    expect(await feeKlpTracker.claimable(user1.address)).gt(
      "3560000000000000000"
    ); // 3.56, 100 / 28 => ~3.57
    expect(await feeKlpTracker.claimable(user1.address)).lt(
      "3580000000000000000"
    ); // 3.58

    expect(await stakedKlpTracker.claimable(user1.address)).gt(
      expandDecimals(1785, 18)
    ); // 50000 / 28 => ~1785
    expect(await stakedKlpTracker.claimable(user1.address)).lt(
      expandDecimals(1786, 18)
    );

    await bnb.mint(user2.address, expandDecimals(1, 18));
    await bnb.connect(user2).approve(klpManager.address, expandDecimals(1, 18));
    await rewardRouter
      .connect(user2)
      .mintAndStakeKlp(
        bnb.address,
        expandDecimals(1, 18),
        expandDecimals(299, 18),
        expandDecimals(299, 18)
      );

    await expect(
      rewardRouter.connect(user2).unstakeAndRedeemKlp(
        bnb.address,
        expandDecimals(299, 18),
        "990000000000000000", // 0.99
        user2.address
      )
    ).to.be.revertedWith("KlpManager: cooldown duration not yet passed");

    expect(await feeKlpTracker.stakedAmounts(user1.address)).eq(
      "897300000000000000000"
    ); // 897.3
    expect(await stakedKlpTracker.stakedAmounts(user1.address)).eq(
      "897300000000000000000"
    );
    expect(await bnb.balanceOf(user1.address)).eq(0);

    const tx1 = await rewardRouter.connect(user1).unstakeAndRedeemKlp(
      bnb.address,
      expandDecimals(299, 18),
      "990000000000000000", // 0.99
      user1.address
    );
    await reportGasUsed(provider, tx1, "unstakeAndRedeemKlp gas used");

    expect(await feeKlpTracker.stakedAmounts(user1.address)).eq(
      "598300000000000000000"
    ); // 598.3
    expect(await stakedKlpTracker.stakedAmounts(user1.address)).eq(
      "598300000000000000000"
    );
    expect(await bnb.balanceOf(user1.address)).eq("993676666666666666"); // ~0.99

    await increaseTime(provider, 24 * 60 * 60);
    await mineBlock(provider);

    expect(await feeKlpTracker.claimable(user1.address)).gt(
      "5940000000000000000"
    ); // 5.94, 3.57 + 100 / 28 / 3 * 2 => ~5.95
    expect(await feeKlpTracker.claimable(user1.address)).lt(
      "5960000000000000000"
    );
    expect(await feeKlpTracker.claimable(user2.address)).gt(
      "1180000000000000000"
    ); // 1.18, 100 / 28 / 3 => ~1.19
    expect(await feeKlpTracker.claimable(user2.address)).lt(
      "1200000000000000000"
    );

    expect(await stakedKlpTracker.claimable(user1.address)).gt(
      expandDecimals(1785 + 1190, 18)
    );
    expect(await stakedKlpTracker.claimable(user1.address)).lt(
      expandDecimals(1786 + 1191, 18)
    );
    expect(await stakedKlpTracker.claimable(user2.address)).gt(
      expandDecimals(595, 18)
    );
    expect(await stakedKlpTracker.claimable(user2.address)).lt(
      expandDecimals(596, 18)
    );

    expect(await esKtx.balanceOf(user1.address)).eq(0);
    await rewardRouter.connect(user1).claimEsKtx();
    expect(await esKtx.balanceOf(user1.address)).gt(
      expandDecimals(1785 + 1190, 18)
    );
    expect(await esKtx.balanceOf(user1.address)).lt(
      expandDecimals(1786 + 1191, 18)
    );

    expect(await eth.balanceOf(user1.address)).eq(0);
    await rewardRouter.connect(user1).claimFees();
    expect(await eth.balanceOf(user1.address)).gt("5940000000000000000");
    expect(await eth.balanceOf(user1.address)).lt("5960000000000000000");

    expect(await esKtx.balanceOf(user2.address)).eq(0);
    await rewardRouter.connect(user2).claimEsKtx();
    expect(await esKtx.balanceOf(user2.address)).gt(expandDecimals(595, 18));
    expect(await esKtx.balanceOf(user2.address)).lt(expandDecimals(596, 18));

    expect(await eth.balanceOf(user2.address)).eq(0);
    await rewardRouter.connect(user2).claimFees();
    expect(await eth.balanceOf(user2.address)).gt("1180000000000000000");
    expect(await eth.balanceOf(user2.address)).lt("1200000000000000000");

    await increaseTime(provider, 24 * 60 * 60);
    await mineBlock(provider);

    const tx2 = await rewardRouter.connect(user1).compound();
    await reportGasUsed(provider, tx2, "compound gas used");

    await increaseTime(provider, 24 * 60 * 60);
    await mineBlock(provider);

    const tx3 = await rewardRouter.batchCompoundForAccounts([
      user1.address,
      user2.address,
    ]);
    await reportGasUsed(provider, tx1, "batchCompoundForAccounts gas used");

    expect(await stakedKtxTracker.stakedAmounts(user1.address)).gt(
      expandDecimals(4165, 18)
    );
    expect(await stakedKtxTracker.stakedAmounts(user1.address)).lt(
      expandDecimals(4167, 18)
    );
    expect(
      await stakedKtxTracker.depositBalances(user1.address, ktx.address)
    ).eq(0);
    expect(
      await stakedKtxTracker.depositBalances(user1.address, esKtx.address)
    ).gt(expandDecimals(4165, 18));
    expect(
      await stakedKtxTracker.depositBalances(user1.address, esKtx.address)
    ).lt(expandDecimals(4167, 18));

    expect(await bonusKtxTracker.stakedAmounts(user1.address)).gt(
      expandDecimals(4165, 18)
    );
    expect(await bonusKtxTracker.stakedAmounts(user1.address)).lt(
      expandDecimals(4167, 18)
    );

    expect(await feeKtxTracker.stakedAmounts(user1.address)).gt(
      expandDecimals(4179, 18)
    );
    expect(await feeKtxTracker.stakedAmounts(user1.address)).lt(
      expandDecimals(4180, 18)
    );
    expect(
      await feeKtxTracker.depositBalances(
        user1.address,
        bonusKtxTracker.address
      )
    ).gt(expandDecimals(4165, 18));
    expect(
      await feeKtxTracker.depositBalances(
        user1.address,
        bonusKtxTracker.address
      )
    ).lt(expandDecimals(4167, 18));
    expect(
      await feeKtxTracker.depositBalances(user1.address, bnKtx.address)
    ).gt("12900000000000000000"); // 12.9
    expect(
      await feeKtxTracker.depositBalances(user1.address, bnKtx.address)
    ).lt("13100000000000000000"); // 13.1

    expect(await feeKlpTracker.stakedAmounts(user1.address)).eq(
      "598300000000000000000"
    ); // 598.3
    expect(await stakedKlpTracker.stakedAmounts(user1.address)).eq(
      "598300000000000000000"
    );
    expect(await bnb.balanceOf(user1.address)).eq("993676666666666666"); // ~0.99
  });

  it("mintAndStakeKlpETH, unstakeAndRedeemKlpETH", async () => {
    const receiver0 = newWallet();
    await expect(
      rewardRouter
        .connect(user0)
        .mintAndStakeKlpETH(expandDecimals(300, 18), expandDecimals(300, 18), {
          value: 0,
        })
    ).to.be.revertedWith("RewardRouter: invalid msg.value");

    await expect(
      rewardRouter
        .connect(user0)
        .mintAndStakeKlpETH(expandDecimals(300, 18), expandDecimals(300, 18), {
          value: expandDecimals(1, 18),
        })
    ).to.be.revertedWith("KlpManager: insufficient USDG output");

    await expect(
      rewardRouter
        .connect(user0)
        .mintAndStakeKlpETH(expandDecimals(299, 18), expandDecimals(300, 18), {
          value: expandDecimals(1, 18),
        })
    ).to.be.revertedWith("KlpManager: insufficient KLP output");

    expect(await bnb.balanceOf(user0.address)).eq(0);
    expect(await bnb.balanceOf(vault.address)).eq(0);
    expect(await bnb.totalSupply()).eq(0);
    expect(await provider.getBalance(bnb.address)).eq(0);
    expect(await stakedKlpTracker.balanceOf(user0.address)).eq(0);

    await rewardRouter
      .connect(user0)
      .mintAndStakeKlpETH(expandDecimals(299, 18), expandDecimals(299, 18), {
        value: expandDecimals(1, 18),
      });

    expect(await bnb.balanceOf(user0.address)).eq(0);
    expect(await bnb.balanceOf(vault.address)).eq(expandDecimals(1, 18));
    expect(await provider.getBalance(bnb.address)).eq(expandDecimals(1, 18));
    expect(await bnb.totalSupply()).eq(expandDecimals(1, 18));
    expect(await stakedKlpTracker.balanceOf(user0.address)).eq(
      "299100000000000000000"
    ); // 299.1

    await expect(
      rewardRouter
        .connect(user0)
        .unstakeAndRedeemKlpETH(
          expandDecimals(300, 18),
          expandDecimals(1, 18),
          receiver0.address
        )
    ).to.be.revertedWith("RewardTracker: _amount exceeds stakedAmount");

    await expect(
      rewardRouter
        .connect(user0)
        .unstakeAndRedeemKlpETH(
          "299100000000000000000",
          expandDecimals(1, 18),
          receiver0.address
        )
    ).to.be.revertedWith("KlpManager: cooldown duration not yet passed");

    await increaseTime(provider, 24 * 60 * 60 + 10);

    await expect(
      rewardRouter
        .connect(user0)
        .unstakeAndRedeemKlpETH(
          "299100000000000000000",
          expandDecimals(1, 18),
          receiver0.address
        )
    ).to.be.revertedWith("KlpManager: insufficient output");

    await rewardRouter
      .connect(user0)
      .unstakeAndRedeemKlpETH(
        "299100000000000000000",
        "990000000000000000",
        receiver0.address
      );
    expect(await provider.getBalance(receiver0.address)).eq(
      "994009000000000000"
    ); // 0.994009
    expect(await bnb.balanceOf(vault.address)).eq("5991000000000000"); // 0.005991
    expect(await provider.getBalance(bnb.address)).eq("5991000000000000");
    expect(await bnb.totalSupply()).eq("5991000000000000");
  });

  it("ktx: signalTransfer, acceptTransfer", async () => {
    await ktx.setMinter(wallet.address, true);
    await ktx.mint(user1.address, expandDecimals(200, 18));
    expect(await ktx.balanceOf(user1.address)).eq(expandDecimals(200, 18));
    await ktx
      .connect(user1)
      .approve(stakedKtxTracker.address, expandDecimals(200, 18));
    await rewardRouter.connect(user1).stakeKtx(expandDecimals(200, 18));
    expect(await ktx.balanceOf(user1.address)).eq(0);

    await ktx.mint(user2.address, expandDecimals(200, 18));
    expect(await ktx.balanceOf(user2.address)).eq(expandDecimals(200, 18));
    await ktx
      .connect(user2)
      .approve(stakedKtxTracker.address, expandDecimals(400, 18));
    await rewardRouter.connect(user2).stakeKtx(expandDecimals(200, 18));
    expect(await ktx.balanceOf(user2.address)).eq(0);

    await rewardRouter.connect(user2).signalTransfer(user1.address);

    await increaseTime(provider, 24 * 60 * 60);
    await mineBlock(provider);

    await rewardRouter.connect(user2).signalTransfer(user1.address);
    await rewardRouter.connect(user1).claim();

    await expect(
      rewardRouter.connect(user2).signalTransfer(user1.address)
    ).to.be.revertedWith(
      "RewardRouter: stakedKtxTracker.averageStakedAmounts > 0"
    );

    await rewardRouter.connect(user2).signalTransfer(user3.address);

    await expect(
      rewardRouter.connect(user3).acceptTransfer(user1.address)
    ).to.be.revertedWith("RewardRouter: transfer not signalled");

    await ktxVester.setBonusRewards(user2.address, expandDecimals(100, 18));

    expect(
      await stakedKtxTracker.depositBalances(user2.address, ktx.address)
    ).eq(expandDecimals(200, 18));
    expect(
      await stakedKtxTracker.depositBalances(user2.address, esKtx.address)
    ).eq(0);
    expect(
      await feeKtxTracker.depositBalances(user2.address, bnKtx.address)
    ).eq(0);
    expect(
      await stakedKtxTracker.depositBalances(user3.address, ktx.address)
    ).eq(0);
    expect(
      await stakedKtxTracker.depositBalances(user3.address, esKtx.address)
    ).eq(0);
    expect(
      await feeKtxTracker.depositBalances(user3.address, bnKtx.address)
    ).eq(0);
    expect(await ktxVester.transferredAverageStakedAmounts(user3.address)).eq(
      0
    );
    expect(await ktxVester.transferredCumulativeRewards(user3.address)).eq(0);
    expect(await ktxVester.bonusRewards(user2.address)).eq(
      expandDecimals(100, 18)
    );
    expect(await ktxVester.bonusRewards(user3.address)).eq(0);
    expect(await ktxVester.getCombinedAverageStakedAmount(user2.address)).eq(0);
    expect(await ktxVester.getCombinedAverageStakedAmount(user3.address)).eq(0);
    expect(await ktxVester.getMaxVestableAmount(user2.address)).eq(
      expandDecimals(100, 18)
    );
    expect(await ktxVester.getMaxVestableAmount(user3.address)).eq(0);
    expect(
      await ktxVester.getPairAmount(user2.address, expandDecimals(892, 18))
    ).eq(0);
    expect(
      await ktxVester.getPairAmount(user3.address, expandDecimals(892, 18))
    ).eq(0);

    await rewardRouter.connect(user3).acceptTransfer(user2.address);

    expect(
      await stakedKtxTracker.depositBalances(user2.address, ktx.address)
    ).eq(0);
    expect(
      await stakedKtxTracker.depositBalances(user2.address, esKtx.address)
    ).eq(0);
    expect(
      await feeKtxTracker.depositBalances(user2.address, bnKtx.address)
    ).eq(0);
    expect(
      await stakedKtxTracker.depositBalances(user3.address, ktx.address)
    ).eq(expandDecimals(200, 18));
    expect(
      await stakedKtxTracker.depositBalances(user3.address, esKtx.address)
    ).gt(expandDecimals(892, 18));
    expect(
      await stakedKtxTracker.depositBalances(user3.address, esKtx.address)
    ).lt(expandDecimals(893, 18));
    expect(
      await feeKtxTracker.depositBalances(user3.address, bnKtx.address)
    ).gt("547000000000000000"); // 0.547
    expect(
      await feeKtxTracker.depositBalances(user3.address, bnKtx.address)
    ).lt("549000000000000000"); // 0.548
    expect(await ktxVester.transferredAverageStakedAmounts(user3.address)).eq(
      expandDecimals(200, 18)
    );
    expect(await ktxVester.transferredCumulativeRewards(user3.address)).gt(
      expandDecimals(892, 18)
    );
    expect(await ktxVester.transferredCumulativeRewards(user3.address)).lt(
      expandDecimals(893, 18)
    );
    expect(await ktxVester.bonusRewards(user2.address)).eq(0);
    expect(await ktxVester.bonusRewards(user3.address)).eq(
      expandDecimals(100, 18)
    );
    expect(await ktxVester.getCombinedAverageStakedAmount(user2.address)).eq(
      expandDecimals(200, 18)
    );
    expect(await ktxVester.getCombinedAverageStakedAmount(user3.address)).eq(
      expandDecimals(200, 18)
    );
    expect(await ktxVester.getMaxVestableAmount(user2.address)).eq(0);
    expect(await ktxVester.getMaxVestableAmount(user3.address)).gt(
      expandDecimals(992, 18)
    );
    expect(await ktxVester.getMaxVestableAmount(user3.address)).lt(
      expandDecimals(993, 18)
    );
    expect(
      await ktxVester.getPairAmount(user2.address, expandDecimals(992, 18))
    ).eq(0);
    expect(
      await ktxVester.getPairAmount(user3.address, expandDecimals(992, 18))
    ).gt(expandDecimals(199, 18));
    expect(
      await ktxVester.getPairAmount(user3.address, expandDecimals(992, 18))
    ).lt(expandDecimals(200, 18));

    await ktx
      .connect(user3)
      .approve(stakedKtxTracker.address, expandDecimals(400, 18));
    await rewardRouter.connect(user3).signalTransfer(user4.address);
    await rewardRouter.connect(user4).acceptTransfer(user3.address);

    expect(
      await stakedKtxTracker.depositBalances(user3.address, ktx.address)
    ).eq(0);
    expect(
      await stakedKtxTracker.depositBalances(user3.address, esKtx.address)
    ).eq(0);
    expect(
      await feeKtxTracker.depositBalances(user3.address, bnKtx.address)
    ).eq(0);
    expect(
      await stakedKtxTracker.depositBalances(user4.address, ktx.address)
    ).eq(expandDecimals(200, 18));
    expect(
      await stakedKtxTracker.depositBalances(user4.address, esKtx.address)
    ).gt(expandDecimals(892, 18));
    expect(
      await stakedKtxTracker.depositBalances(user4.address, esKtx.address)
    ).lt(expandDecimals(893, 18));
    expect(
      await feeKtxTracker.depositBalances(user4.address, bnKtx.address)
    ).gt("547000000000000000"); // 0.547
    expect(
      await feeKtxTracker.depositBalances(user4.address, bnKtx.address)
    ).lt("549000000000000000"); // 0.548
    expect(await ktxVester.transferredAverageStakedAmounts(user4.address)).gt(
      expandDecimals(200, 18)
    );
    expect(await ktxVester.transferredAverageStakedAmounts(user4.address)).lt(
      expandDecimals(201, 18)
    );
    expect(await ktxVester.transferredCumulativeRewards(user4.address)).gt(
      expandDecimals(892, 18)
    );
    expect(await ktxVester.transferredCumulativeRewards(user4.address)).lt(
      expandDecimals(894, 18)
    );
    expect(await ktxVester.bonusRewards(user3.address)).eq(0);
    expect(await ktxVester.bonusRewards(user4.address)).eq(
      expandDecimals(100, 18)
    );
    expect(await stakedKtxTracker.averageStakedAmounts(user3.address)).gt(
      expandDecimals(1092, 18)
    );
    expect(await stakedKtxTracker.averageStakedAmounts(user3.address)).lt(
      expandDecimals(1094, 18)
    );
    expect(await ktxVester.transferredAverageStakedAmounts(user3.address)).eq(
      0
    );
    expect(await ktxVester.getCombinedAverageStakedAmount(user3.address)).gt(
      expandDecimals(1092, 18)
    );
    expect(await ktxVester.getCombinedAverageStakedAmount(user3.address)).lt(
      expandDecimals(1094, 18)
    );
    expect(await ktxVester.getCombinedAverageStakedAmount(user4.address)).gt(
      expandDecimals(200, 18)
    );
    expect(await ktxVester.getCombinedAverageStakedAmount(user4.address)).lt(
      expandDecimals(201, 18)
    );
    expect(await ktxVester.getMaxVestableAmount(user3.address)).eq(0);
    expect(await ktxVester.getMaxVestableAmount(user4.address)).gt(
      expandDecimals(992, 18)
    );
    expect(await ktxVester.getMaxVestableAmount(user4.address)).lt(
      expandDecimals(993, 18)
    );
    expect(
      await ktxVester.getPairAmount(user3.address, expandDecimals(992, 18))
    ).eq(0);
    expect(
      await ktxVester.getPairAmount(user4.address, expandDecimals(992, 18))
    ).gt(expandDecimals(199, 18));
    expect(
      await ktxVester.getPairAmount(user4.address, expandDecimals(992, 18))
    ).lt(expandDecimals(200, 18));

    await expect(
      rewardRouter.connect(user4).acceptTransfer(user3.address)
    ).to.be.revertedWith("RewardRouter: transfer not signalled");
  });

  it("ktx, klp: signalTransfer, acceptTransfer", async () => {
    await ktx.setMinter(wallet.address, true);
    await ktx.mint(ktxVester.address, expandDecimals(10000, 18));
    await ktx.mint(klpVester.address, expandDecimals(10000, 18));
    await eth.mint(feeKlpDistributor.address, expandDecimals(100, 18));
    await feeKlpDistributor.setTokensPerInterval("41335970000000"); // 0.00004133597 ETH per second

    await bnb.mint(user1.address, expandDecimals(1, 18));
    await bnb.connect(user1).approve(klpManager.address, expandDecimals(1, 18));
    await rewardRouter
      .connect(user1)
      .mintAndStakeKlp(
        bnb.address,
        expandDecimals(1, 18),
        expandDecimals(299, 18),
        expandDecimals(299, 18)
      );

    await bnb.mint(user2.address, expandDecimals(1, 18));
    await bnb.connect(user2).approve(klpManager.address, expandDecimals(1, 18));
    await rewardRouter
      .connect(user2)
      .mintAndStakeKlp(
        bnb.address,
        expandDecimals(1, 18),
        expandDecimals(299, 18),
        expandDecimals(299, 18)
      );

    await ktx.mint(user1.address, expandDecimals(200, 18));
    expect(await ktx.balanceOf(user1.address)).eq(expandDecimals(200, 18));
    await ktx
      .connect(user1)
      .approve(stakedKtxTracker.address, expandDecimals(200, 18));
    await rewardRouter.connect(user1).stakeKtx(expandDecimals(200, 18));
    expect(await ktx.balanceOf(user1.address)).eq(0);

    await ktx.mint(user2.address, expandDecimals(200, 18));
    expect(await ktx.balanceOf(user2.address)).eq(expandDecimals(200, 18));
    await ktx
      .connect(user2)
      .approve(stakedKtxTracker.address, expandDecimals(400, 18));
    await rewardRouter.connect(user2).stakeKtx(expandDecimals(200, 18));
    expect(await ktx.balanceOf(user2.address)).eq(0);

    await rewardRouter.connect(user2).signalTransfer(user1.address);

    await increaseTime(provider, 24 * 60 * 60);
    await mineBlock(provider);

    await rewardRouter.connect(user2).signalTransfer(user1.address);
    await rewardRouter.connect(user1).compound();

    await expect(
      rewardRouter.connect(user2).signalTransfer(user1.address)
    ).to.be.revertedWith(
      "RewardRouter: stakedKtxTracker.averageStakedAmounts > 0"
    );

    await rewardRouter.connect(user2).signalTransfer(user3.address);

    await expect(
      rewardRouter.connect(user3).acceptTransfer(user1.address)
    ).to.be.revertedWith("RewardRouter: transfer not signalled");

    await ktxVester.setBonusRewards(user2.address, expandDecimals(100, 18));

    expect(
      await stakedKtxTracker.depositBalances(user2.address, ktx.address)
    ).eq(expandDecimals(200, 18));
    expect(
      await stakedKtxTracker.depositBalances(user2.address, esKtx.address)
    ).eq(0);
    expect(
      await stakedKtxTracker.depositBalances(user3.address, ktx.address)
    ).eq(0);
    expect(
      await stakedKtxTracker.depositBalances(user3.address, esKtx.address)
    ).eq(0);

    expect(
      await feeKtxTracker.depositBalances(user2.address, bnKtx.address)
    ).eq(0);
    expect(
      await feeKtxTracker.depositBalances(user3.address, bnKtx.address)
    ).eq(0);

    expect(await feeKlpTracker.depositBalances(user2.address, klp.address)).eq(
      "299100000000000000000"
    ); // 299.1
    expect(await feeKlpTracker.depositBalances(user3.address, klp.address)).eq(
      0
    );

    expect(
      await stakedKlpTracker.depositBalances(
        user2.address,
        feeKlpTracker.address
      )
    ).eq("299100000000000000000"); // 299.1
    expect(
      await stakedKlpTracker.depositBalances(
        user3.address,
        feeKlpTracker.address
      )
    ).eq(0);

    expect(await ktxVester.transferredAverageStakedAmounts(user3.address)).eq(
      0
    );
    expect(await ktxVester.transferredCumulativeRewards(user3.address)).eq(0);
    expect(await ktxVester.bonusRewards(user2.address)).eq(
      expandDecimals(100, 18)
    );
    expect(await ktxVester.bonusRewards(user3.address)).eq(0);
    expect(await ktxVester.getCombinedAverageStakedAmount(user2.address)).eq(0);
    expect(await ktxVester.getCombinedAverageStakedAmount(user3.address)).eq(0);
    expect(await ktxVester.getMaxVestableAmount(user2.address)).eq(
      expandDecimals(100, 18)
    );
    expect(await ktxVester.getMaxVestableAmount(user3.address)).eq(0);
    expect(
      await ktxVester.getPairAmount(user2.address, expandDecimals(892, 18))
    ).eq(0);
    expect(
      await ktxVester.getPairAmount(user3.address, expandDecimals(892, 18))
    ).eq(0);

    await rewardRouter.connect(user3).acceptTransfer(user2.address);

    expect(
      await stakedKtxTracker.depositBalances(user2.address, ktx.address)
    ).eq(0);
    expect(
      await stakedKtxTracker.depositBalances(user2.address, esKtx.address)
    ).eq(0);
    expect(
      await stakedKtxTracker.depositBalances(user3.address, ktx.address)
    ).eq(expandDecimals(200, 18));
    expect(
      await stakedKtxTracker.depositBalances(user3.address, esKtx.address)
    ).gt(expandDecimals(1785, 18));
    expect(
      await stakedKtxTracker.depositBalances(user3.address, esKtx.address)
    ).lt(expandDecimals(1786, 18));

    expect(
      await feeKtxTracker.depositBalances(user2.address, bnKtx.address)
    ).eq(0);
    expect(
      await feeKtxTracker.depositBalances(user3.address, bnKtx.address)
    ).gt("547000000000000000"); // 0.547
    expect(
      await feeKtxTracker.depositBalances(user3.address, bnKtx.address)
    ).lt("549000000000000000"); // 0.548

    expect(await feeKlpTracker.depositBalances(user2.address, klp.address)).eq(
      0
    );
    expect(await feeKlpTracker.depositBalances(user3.address, klp.address)).eq(
      "299100000000000000000"
    ); // 299.1

    expect(
      await stakedKlpTracker.depositBalances(
        user2.address,
        feeKlpTracker.address
      )
    ).eq(0);
    expect(
      await stakedKlpTracker.depositBalances(
        user3.address,
        feeKlpTracker.address
      )
    ).eq("299100000000000000000"); // 299.1

    expect(await ktxVester.transferredAverageStakedAmounts(user3.address)).eq(
      expandDecimals(200, 18)
    );
    expect(await ktxVester.transferredCumulativeRewards(user3.address)).gt(
      expandDecimals(892, 18)
    );
    expect(await ktxVester.transferredCumulativeRewards(user3.address)).lt(
      expandDecimals(893, 18)
    );
    expect(await ktxVester.bonusRewards(user2.address)).eq(0);
    expect(await ktxVester.bonusRewards(user3.address)).eq(
      expandDecimals(100, 18)
    );
    expect(await ktxVester.getCombinedAverageStakedAmount(user2.address)).eq(
      expandDecimals(200, 18)
    );
    expect(await ktxVester.getCombinedAverageStakedAmount(user3.address)).eq(
      expandDecimals(200, 18)
    );
    expect(await ktxVester.getMaxVestableAmount(user2.address)).eq(0);
    expect(await ktxVester.getMaxVestableAmount(user3.address)).gt(
      expandDecimals(992, 18)
    );
    expect(await ktxVester.getMaxVestableAmount(user3.address)).lt(
      expandDecimals(993, 18)
    );
    expect(
      await ktxVester.getPairAmount(user2.address, expandDecimals(992, 18))
    ).eq(0);
    expect(
      await ktxVester.getPairAmount(user3.address, expandDecimals(992, 18))
    ).gt(expandDecimals(199, 18));
    expect(
      await ktxVester.getPairAmount(user3.address, expandDecimals(992, 18))
    ).lt(expandDecimals(200, 18));
    expect(
      await ktxVester.getPairAmount(user1.address, expandDecimals(892, 18))
    ).gt(expandDecimals(199, 18));
    expect(
      await ktxVester.getPairAmount(user1.address, expandDecimals(892, 18))
    ).lt(expandDecimals(200, 18));

    await rewardRouter.connect(user1).compound();

    await expect(
      rewardRouter.connect(user3).acceptTransfer(user1.address)
    ).to.be.revertedWith("RewardRouter: transfer not signalled");

    await increaseTime(provider, 24 * 60 * 60);
    await mineBlock(provider);

    await rewardRouter.connect(user1).claim();
    await rewardRouter.connect(user2).claim();
    await rewardRouter.connect(user3).claim();

    expect(await ktxVester.getCombinedAverageStakedAmount(user1.address)).gt(
      expandDecimals(1092, 18)
    );
    expect(await ktxVester.getCombinedAverageStakedAmount(user1.address)).lt(
      expandDecimals(1094, 18)
    );
    expect(await ktxVester.getCombinedAverageStakedAmount(user3.address)).gt(
      expandDecimals(1092, 18)
    );
    expect(await ktxVester.getCombinedAverageStakedAmount(user3.address)).lt(
      expandDecimals(1094, 18)
    );

    expect(await ktxVester.getMaxVestableAmount(user2.address)).eq(0);
    expect(await ktxVester.getMaxVestableAmount(user3.address)).gt(
      expandDecimals(1885, 18)
    );
    expect(await ktxVester.getMaxVestableAmount(user3.address)).lt(
      expandDecimals(1887, 18)
    );
    expect(await ktxVester.getMaxVestableAmount(user1.address)).gt(
      expandDecimals(1785, 18)
    );
    expect(await ktxVester.getMaxVestableAmount(user1.address)).lt(
      expandDecimals(1787, 18)
    );

    expect(
      await ktxVester.getPairAmount(user2.address, expandDecimals(992, 18))
    ).eq(0);
    expect(
      await ktxVester.getPairAmount(user3.address, expandDecimals(1885, 18))
    ).gt(expandDecimals(1092, 18));
    expect(
      await ktxVester.getPairAmount(user3.address, expandDecimals(1885, 18))
    ).lt(expandDecimals(1094, 18));
    expect(
      await ktxVester.getPairAmount(user1.address, expandDecimals(1785, 18))
    ).gt(expandDecimals(1092, 18));
    expect(
      await ktxVester.getPairAmount(user1.address, expandDecimals(1785, 18))
    ).lt(expandDecimals(1094, 18));

    await rewardRouter.connect(user1).compound();
    await rewardRouter.connect(user3).compound();

    expect(await feeKtxTracker.balanceOf(user1.address)).gt(
      expandDecimals(1992, 18)
    );
    expect(await feeKtxTracker.balanceOf(user1.address)).lt(
      expandDecimals(1993, 18)
    );

    await ktxVester.connect(user1).deposit(expandDecimals(1785, 18));

    expect(await feeKtxTracker.balanceOf(user1.address)).gt(
      expandDecimals(1991 - 1092, 18)
    ); // 899
    expect(await feeKtxTracker.balanceOf(user1.address)).lt(
      expandDecimals(1993 - 1092, 18)
    ); // 901

    expect(
      await feeKtxTracker.depositBalances(user1.address, bnKtx.address)
    ).gt(expandDecimals(4, 18));
    expect(
      await feeKtxTracker.depositBalances(user1.address, bnKtx.address)
    ).lt(expandDecimals(6, 18));

    await rewardRouter.connect(user1).unstakeKtx(expandDecimals(200, 18));
    await expect(
      rewardRouter.connect(user1).unstakeEsKtx(expandDecimals(699, 18))
    ).to.be.revertedWith("RewardTracker: burn amount exceeds balance");

    await rewardRouter.connect(user1).unstakeEsKtx(expandDecimals(599, 18));

    await increaseTime(provider, 24 * 60 * 60);
    await mineBlock(provider);

    expect(await feeKtxTracker.balanceOf(user1.address)).gt(
      expandDecimals(97, 18)
    );
    expect(await feeKtxTracker.balanceOf(user1.address)).lt(
      expandDecimals(99, 18)
    );

    expect(await esKtx.balanceOf(user1.address)).gt(expandDecimals(599, 18));
    expect(await esKtx.balanceOf(user1.address)).lt(expandDecimals(601, 18));

    expect(await ktx.balanceOf(user1.address)).eq(expandDecimals(200, 18));

    await ktxVester.connect(user1).withdraw();

    expect(await feeKtxTracker.balanceOf(user1.address)).gt(
      expandDecimals(1190, 18)
    ); // 1190 - 98 => 1092
    expect(await feeKtxTracker.balanceOf(user1.address)).lt(
      expandDecimals(1191, 18)
    );

    expect(await esKtx.balanceOf(user1.address)).gt(expandDecimals(2378, 18));
    expect(await esKtx.balanceOf(user1.address)).lt(expandDecimals(2380, 18));

    expect(await ktx.balanceOf(user1.address)).gt(expandDecimals(204, 18));
    expect(await ktx.balanceOf(user1.address)).lt(expandDecimals(206, 18));

    expect(await klpVester.getMaxVestableAmount(user3.address)).gt(
      expandDecimals(1785, 18)
    );
    expect(await klpVester.getMaxVestableAmount(user3.address)).lt(
      expandDecimals(1787, 18)
    );

    expect(
      await klpVester.getPairAmount(user3.address, expandDecimals(1785, 18))
    ).gt(expandDecimals(298, 18));
    expect(
      await klpVester.getPairAmount(user3.address, expandDecimals(1785, 18))
    ).lt(expandDecimals(300, 18));

    expect(await stakedKlpTracker.balanceOf(user3.address)).eq(
      "299100000000000000000"
    );

    expect(await esKtx.balanceOf(user3.address)).gt(expandDecimals(1785, 18));
    expect(await esKtx.balanceOf(user3.address)).lt(expandDecimals(1787, 18));

    expect(await ktx.balanceOf(user3.address)).eq(0);

    await klpVester.connect(user3).deposit(expandDecimals(1785, 18));

    expect(await stakedKlpTracker.balanceOf(user3.address)).gt(0);
    expect(await stakedKlpTracker.balanceOf(user3.address)).lt(
      expandDecimals(1, 18)
    );

    expect(await esKtx.balanceOf(user3.address)).gt(0);
    expect(await esKtx.balanceOf(user3.address)).lt(expandDecimals(1, 18));

    expect(await ktx.balanceOf(user3.address)).eq(0);

    await expect(
      rewardRouter
        .connect(user3)
        .unstakeAndRedeemKlp(
          bnb.address,
          expandDecimals(1, 18),
          0,
          user3.address
        )
    ).to.be.revertedWith("RewardTracker: burn amount exceeds balance");

    await increaseTime(provider, 24 * 60 * 60);
    await mineBlock(provider);

    await klpVester.connect(user3).withdraw();

    expect(await stakedKlpTracker.balanceOf(user3.address)).eq(
      "299100000000000000000"
    );

    expect(await esKtx.balanceOf(user3.address)).gt(
      expandDecimals(1785 - 5, 18)
    );
    expect(await esKtx.balanceOf(user3.address)).lt(
      expandDecimals(1787 - 5, 18)
    );

    expect(await ktx.balanceOf(user3.address)).gt(expandDecimals(4, 18));
    expect(await ktx.balanceOf(user3.address)).lt(expandDecimals(6, 18));

    expect(await feeKtxTracker.balanceOf(user1.address)).gt(
      expandDecimals(1190, 18)
    );
    expect(await feeKtxTracker.balanceOf(user1.address)).lt(
      expandDecimals(1191, 18)
    );

    expect(await esKtx.balanceOf(user1.address)).gt(expandDecimals(2379, 18));
    expect(await esKtx.balanceOf(user1.address)).lt(expandDecimals(2381, 18));

    expect(await ktx.balanceOf(user1.address)).gt(expandDecimals(204, 18));
    expect(await ktx.balanceOf(user1.address)).lt(expandDecimals(206, 18));

    await ktxVester.connect(user1).deposit(expandDecimals(365 * 2, 18));

    expect(await feeKtxTracker.balanceOf(user1.address)).gt(
      expandDecimals(743, 18)
    ); // 1190 - 743 => 447
    expect(await feeKtxTracker.balanceOf(user1.address)).lt(
      expandDecimals(754, 18)
    );

    expect(await ktxVester.claimable(user1.address)).eq(0);

    await increaseTime(provider, 48 * 60 * 60);
    await mineBlock(provider);

    expect(await ktxVester.claimable(user1.address)).gt("3900000000000000000"); // 3.9
    expect(await ktxVester.claimable(user1.address)).lt("4100000000000000000"); // 4.1

    await ktxVester.connect(user1).deposit(expandDecimals(365, 18));

    expect(await feeKtxTracker.balanceOf(user1.address)).gt(
      expandDecimals(522, 18)
    ); // 743 - 522 => 221
    expect(await feeKtxTracker.balanceOf(user1.address)).lt(
      expandDecimals(524, 18)
    );

    await increaseTime(provider, 48 * 60 * 60);
    await mineBlock(provider);

    expect(await ktxVester.claimable(user1.address)).gt("9900000000000000000"); // 9.9
    expect(await ktxVester.claimable(user1.address)).lt("10100000000000000000"); // 10.1

    expect(await ktx.balanceOf(user1.address)).gt(expandDecimals(204, 18));
    expect(await ktx.balanceOf(user1.address)).lt(expandDecimals(206, 18));

    await ktxVester.connect(user1).claim();

    expect(await ktx.balanceOf(user1.address)).gt(expandDecimals(214, 18));
    expect(await ktx.balanceOf(user1.address)).lt(expandDecimals(216, 18));

    await ktxVester.connect(user1).deposit(expandDecimals(365, 18));
    expect(await ktxVester.balanceOf(user1.address)).gt(
      expandDecimals(1449, 18)
    ); // 365 * 4 => 1460, 1460 - 10 => 1450
    expect(await ktxVester.balanceOf(user1.address)).lt(
      expandDecimals(1451, 18)
    );
    expect(await ktxVester.getVestedAmount(user1.address)).eq(
      expandDecimals(1460, 18)
    );

    expect(await feeKtxTracker.balanceOf(user1.address)).gt(
      expandDecimals(303, 18)
    ); // 522 - 303 => 219
    expect(await feeKtxTracker.balanceOf(user1.address)).lt(
      expandDecimals(304, 18)
    );

    await increaseTime(provider, 48 * 60 * 60);
    await mineBlock(provider);

    expect(await ktxVester.claimable(user1.address)).gt("7900000000000000000"); // 7.9
    expect(await ktxVester.claimable(user1.address)).lt("8100000000000000000"); // 8.1

    await ktxVester.connect(user1).withdraw();

    expect(await feeKtxTracker.balanceOf(user1.address)).gt(
      expandDecimals(1190, 18)
    );
    expect(await feeKtxTracker.balanceOf(user1.address)).lt(
      expandDecimals(1191, 18)
    );

    expect(await ktx.balanceOf(user1.address)).gt(expandDecimals(222, 18));
    expect(await ktx.balanceOf(user1.address)).lt(expandDecimals(224, 18));

    expect(await esKtx.balanceOf(user1.address)).gt(expandDecimals(2360, 18));
    expect(await esKtx.balanceOf(user1.address)).lt(expandDecimals(2362, 18));

    await ktxVester.connect(user1).deposit(expandDecimals(365, 18));

    await increaseTime(provider, 500 * 24 * 60 * 60);
    await mineBlock(provider);

    expect(await ktxVester.claimable(user1.address)).eq(
      expandDecimals(365, 18)
    );

    await ktxVester.connect(user1).withdraw();

    expect(await ktx.balanceOf(user1.address)).gt(
      expandDecimals(222 + 365, 18)
    );
    expect(await ktx.balanceOf(user1.address)).lt(
      expandDecimals(224 + 365, 18)
    );

    expect(await esKtx.balanceOf(user1.address)).gt(
      expandDecimals(2360 - 365, 18)
    );
    expect(await esKtx.balanceOf(user1.address)).lt(
      expandDecimals(2362 - 365, 18)
    );

    expect(await ktxVester.transferredAverageStakedAmounts(user2.address)).eq(
      0
    );
    expect(await ktxVester.transferredAverageStakedAmounts(user3.address)).eq(
      expandDecimals(200, 18)
    );
    expect(await stakedKtxTracker.cumulativeRewards(user2.address)).gt(
      expandDecimals(892, 18)
    );
    expect(await stakedKtxTracker.cumulativeRewards(user2.address)).lt(
      expandDecimals(893, 18)
    );
    expect(await stakedKtxTracker.cumulativeRewards(user3.address)).gt(
      expandDecimals(892, 18)
    );
    expect(await stakedKtxTracker.cumulativeRewards(user3.address)).lt(
      expandDecimals(893, 18)
    );
    expect(await ktxVester.transferredCumulativeRewards(user3.address)).gt(
      expandDecimals(892, 18)
    );
    expect(await ktxVester.transferredCumulativeRewards(user3.address)).lt(
      expandDecimals(893, 18)
    );
    expect(await ktxVester.bonusRewards(user2.address)).eq(0);
    expect(await ktxVester.bonusRewards(user3.address)).eq(
      expandDecimals(100, 18)
    );
    expect(await ktxVester.getCombinedAverageStakedAmount(user2.address)).eq(
      expandDecimals(200, 18)
    );
    expect(await ktxVester.getCombinedAverageStakedAmount(user3.address)).gt(
      expandDecimals(1092, 18)
    );
    expect(await ktxVester.getCombinedAverageStakedAmount(user3.address)).lt(
      expandDecimals(1093, 18)
    );
    expect(await ktxVester.getMaxVestableAmount(user2.address)).eq(0);
    expect(await ktxVester.getMaxVestableAmount(user3.address)).gt(
      expandDecimals(1884, 18)
    );
    expect(await ktxVester.getMaxVestableAmount(user3.address)).lt(
      expandDecimals(1886, 18)
    );
    expect(
      await ktxVester.getPairAmount(user2.address, expandDecimals(992, 18))
    ).eq(0);
    expect(
      await ktxVester.getPairAmount(user3.address, expandDecimals(992, 18))
    ).gt(expandDecimals(574, 18));
    expect(
      await ktxVester.getPairAmount(user3.address, expandDecimals(992, 18))
    ).lt(expandDecimals(575, 18));
    expect(
      await ktxVester.getPairAmount(user1.address, expandDecimals(892, 18))
    ).gt(expandDecimals(545, 18));
    expect(
      await ktxVester.getPairAmount(user1.address, expandDecimals(892, 18))
    ).lt(expandDecimals(546, 18));

    const esKtxBatchSender = await deployContract("EsKtxBatchSender", [
      esKtx.address,
    ]);

    await timelock.signalSetHandler(
      esKtx.address,
      esKtxBatchSender.address,
      true
    );
    await timelock.signalSetHandler(
      ktxVester.address,
      esKtxBatchSender.address,
      true
    );
    await timelock.signalSetHandler(
      klpVester.address,
      esKtxBatchSender.address,
      true
    );
    await timelock.signalMint(
      esKtx.address,
      wallet.address,
      expandDecimals(1000, 18)
    );

    await increaseTime(provider, 20);
    await mineBlock(provider);

    await timelock.setHandler(esKtx.address, esKtxBatchSender.address, true);
    await timelock.setHandler(
      ktxVester.address,
      esKtxBatchSender.address,
      true
    );
    await timelock.setHandler(
      klpVester.address,
      esKtxBatchSender.address,
      true
    );
    await timelock.processMint(
      esKtx.address,
      wallet.address,
      expandDecimals(1000, 18)
    );

    await esKtxBatchSender
      .connect(wallet)
      .send(
        ktxVester.address,
        4,
        [user2.address, user3.address],
        [expandDecimals(100, 18), expandDecimals(200, 18)]
      );

    expect(await ktxVester.transferredAverageStakedAmounts(user2.address)).gt(
      expandDecimals(37648, 18)
    );
    expect(await ktxVester.transferredAverageStakedAmounts(user2.address)).lt(
      expandDecimals(37649, 18)
    );
    expect(await ktxVester.transferredAverageStakedAmounts(user3.address)).gt(
      expandDecimals(12810, 18)
    );
    expect(await ktxVester.transferredAverageStakedAmounts(user3.address)).lt(
      expandDecimals(12811, 18)
    );
    expect(await ktxVester.transferredCumulativeRewards(user2.address)).eq(
      expandDecimals(100, 18)
    );
    expect(await ktxVester.transferredCumulativeRewards(user3.address)).gt(
      expandDecimals(892 + 200, 18)
    );
    expect(await ktxVester.transferredCumulativeRewards(user3.address)).lt(
      expandDecimals(893 + 200, 18)
    );
    expect(await ktxVester.bonusRewards(user2.address)).eq(0);
    expect(await ktxVester.bonusRewards(user3.address)).eq(
      expandDecimals(100, 18)
    );
    expect(await ktxVester.getCombinedAverageStakedAmount(user2.address)).gt(
      expandDecimals(3971, 18)
    );
    expect(await ktxVester.getCombinedAverageStakedAmount(user2.address)).lt(
      expandDecimals(3972, 18)
    );
    expect(await ktxVester.getCombinedAverageStakedAmount(user3.address)).gt(
      expandDecimals(7943, 18)
    );
    expect(await ktxVester.getCombinedAverageStakedAmount(user3.address)).lt(
      expandDecimals(7944, 18)
    );
    expect(await ktxVester.getMaxVestableAmount(user2.address)).eq(
      expandDecimals(100, 18)
    );
    expect(await ktxVester.getMaxVestableAmount(user3.address)).gt(
      expandDecimals(1884 + 200, 18)
    );
    expect(await ktxVester.getMaxVestableAmount(user3.address)).lt(
      expandDecimals(1886 + 200, 18)
    );
    expect(
      await ktxVester.getPairAmount(user2.address, expandDecimals(100, 18))
    ).gt(expandDecimals(3971, 18));
    expect(
      await ktxVester.getPairAmount(user2.address, expandDecimals(100, 18))
    ).lt(expandDecimals(3972, 18));
    expect(
      await ktxVester.getPairAmount(
        user3.address,
        expandDecimals(1884 + 200, 18)
      )
    ).gt(expandDecimals(7936, 18));
    expect(
      await ktxVester.getPairAmount(
        user3.address,
        expandDecimals(1884 + 200, 18)
      )
    ).lt(expandDecimals(7937, 18));

    expect(await klpVester.transferredAverageStakedAmounts(user4.address)).eq(
      0
    );
    expect(await klpVester.transferredCumulativeRewards(user4.address)).eq(0);
    expect(await klpVester.bonusRewards(user4.address)).eq(0);
    expect(await klpVester.getCombinedAverageStakedAmount(user4.address)).eq(0);
    expect(await klpVester.getMaxVestableAmount(user4.address)).eq(0);
    expect(
      await klpVester.getPairAmount(user4.address, expandDecimals(10, 18))
    ).eq(0);

    await esKtxBatchSender
      .connect(wallet)
      .send(klpVester.address, 320, [user4.address], [expandDecimals(10, 18)]);

    expect(await klpVester.transferredAverageStakedAmounts(user4.address)).eq(
      expandDecimals(3200, 18)
    );
    expect(await klpVester.transferredCumulativeRewards(user4.address)).eq(
      expandDecimals(10, 18)
    );
    expect(await klpVester.bonusRewards(user4.address)).eq(0);
    expect(await klpVester.getCombinedAverageStakedAmount(user4.address)).eq(
      expandDecimals(3200, 18)
    );
    expect(await klpVester.getMaxVestableAmount(user4.address)).eq(
      expandDecimals(10, 18)
    );
    expect(
      await klpVester.getPairAmount(user4.address, expandDecimals(10, 18))
    ).eq(expandDecimals(3200, 18));

    await esKtxBatchSender
      .connect(wallet)
      .send(klpVester.address, 320, [user4.address], [expandDecimals(10, 18)]);

    expect(await klpVester.transferredAverageStakedAmounts(user4.address)).eq(
      expandDecimals(6400, 18)
    );
    expect(await klpVester.transferredCumulativeRewards(user4.address)).eq(
      expandDecimals(20, 18)
    );
    expect(await klpVester.bonusRewards(user4.address)).eq(0);
    expect(await klpVester.getCombinedAverageStakedAmount(user4.address)).eq(
      expandDecimals(6400, 18)
    );
    expect(await klpVester.getMaxVestableAmount(user4.address)).eq(
      expandDecimals(20, 18)
    );
    expect(
      await klpVester.getPairAmount(user4.address, expandDecimals(10, 18))
    ).eq(expandDecimals(3200, 18));
  });

  it("handleRewards", async () => {
    const rewardManagerV2 = await deployContract("RewardManager", []);

    // use new rewardRouter, use eth for weth
    const rewardRouterV2 = await deployContract("RewardRouter", []);
    await rewardRouterV2.initialize(
      eth.address,
      ktx.address,
      esKtx.address,
      bnKtx.address,
      klp.address,
      stakedKtxTracker.address,
      bonusKtxTracker.address,
      feeKtxTracker.address,
      feeKlpTracker.address,
      stakedKlpTracker.address,
      klpManager.address,
      ktxVester.address,
      klpVester.address
    );

    const timelockV2 = await deployContract("Timelock", [
      wallet.address,
      10,
      tokenManager.address,
      ADDRESS_ZERO,
      tokenManager.address,
      rewardRouterV2.address,
      rewardManagerV2.address,
      expandDecimals(1000000, 18),
      10,
      100,
    ]);

    await rewardManagerV2.initialize(
      timelockV2.address,
      rewardRouterV2.address,
      klpManager.address,
      stakedKtxTracker.address,
      bonusKtxTracker.address,
      feeKtxTracker.address,
      feeKlpTracker.address,
      stakedKlpTracker.address,
      stakedKtxDistributor.address,
      stakedKlpDistributor.address,
      esKtx.address,
      bnKtx.address,
      ktxVester.address,
      klpVester.address
    );

    await timelock.signalSetGov(klpManager.address, timelockV2.address);
    await timelock.signalSetGov(stakedKtxTracker.address, timelockV2.address);
    await timelock.signalSetGov(bonusKtxTracker.address, timelockV2.address);
    await timelock.signalSetGov(feeKtxTracker.address, timelockV2.address);
    await timelock.signalSetGov(feeKlpTracker.address, timelockV2.address);
    await timelock.signalSetGov(stakedKlpTracker.address, timelockV2.address);
    await timelock.signalSetGov(
      stakedKtxDistributor.address,
      timelockV2.address
    );
    await timelock.signalSetGov(
      stakedKlpDistributor.address,
      timelockV2.address
    );
    await timelock.signalSetGov(esKtx.address, timelockV2.address);
    await timelock.signalSetGov(bnKtx.address, timelockV2.address);
    await timelock.signalSetGov(ktxVester.address, timelockV2.address);
    await timelock.signalSetGov(klpVester.address, timelockV2.address);

    await increaseTime(provider, 20);
    await mineBlock(provider);

    await timelock.setGov(klpManager.address, timelockV2.address);
    await timelock.setGov(stakedKtxTracker.address, timelockV2.address);
    await timelock.setGov(bonusKtxTracker.address, timelockV2.address);
    await timelock.setGov(feeKtxTracker.address, timelockV2.address);
    await timelock.setGov(feeKlpTracker.address, timelockV2.address);
    await timelock.setGov(stakedKlpTracker.address, timelockV2.address);
    await timelock.setGov(stakedKtxDistributor.address, timelockV2.address);
    await timelock.setGov(stakedKlpDistributor.address, timelockV2.address);
    await timelock.setGov(esKtx.address, timelockV2.address);
    await timelock.setGov(bnKtx.address, timelockV2.address);
    await timelock.setGov(ktxVester.address, timelockV2.address);
    await timelock.setGov(klpVester.address, timelockV2.address);

    await rewardManagerV2.updateEsKtxHandlers();
    await rewardManagerV2.enableRewardRouter();

    await eth.deposit({ value: expandDecimals(10, 18) });

    await ktx.setMinter(wallet.address, true);
    await ktx.mint(ktxVester.address, expandDecimals(10000, 18));
    await ktx.mint(klpVester.address, expandDecimals(10000, 18));

    await eth.mint(feeKlpDistributor.address, expandDecimals(50, 18));
    await feeKlpDistributor.setTokensPerInterval("41335970000000"); // 0.00004133597 ETH per second

    await eth.mint(feeKtxDistributor.address, expandDecimals(50, 18));
    await feeKtxDistributor.setTokensPerInterval("41335970000000"); // 0.00004133597 ETH per second

    await bnb.mint(user1.address, expandDecimals(1, 18));
    await bnb.connect(user1).approve(klpManager.address, expandDecimals(1, 18));
    await rewardRouterV2
      .connect(user1)
      .mintAndStakeKlp(
        bnb.address,
        expandDecimals(1, 18),
        expandDecimals(299, 18),
        expandDecimals(299, 18)
      );

    await ktx.mint(user1.address, expandDecimals(200, 18));
    expect(await ktx.balanceOf(user1.address)).eq(expandDecimals(200, 18));
    await ktx
      .connect(user1)
      .approve(stakedKtxTracker.address, expandDecimals(200, 18));
    await rewardRouterV2.connect(user1).stakeKtx(expandDecimals(200, 18));
    expect(await ktx.balanceOf(user1.address)).eq(0);

    await increaseTime(provider, 24 * 60 * 60);
    await mineBlock(provider);

    expect(await ktx.balanceOf(user1.address)).eq(0);
    expect(await esKtx.balanceOf(user1.address)).eq(0);
    expect(await bnKtx.balanceOf(user1.address)).eq(0);
    expect(await klp.balanceOf(user1.address)).eq(0);
    expect(await eth.balanceOf(user1.address)).eq(0);

    expect(
      await stakedKtxTracker.depositBalances(user1.address, ktx.address)
    ).eq(expandDecimals(200, 18));
    expect(
      await stakedKtxTracker.depositBalances(user1.address, esKtx.address)
    ).eq(0);
    expect(
      await feeKtxTracker.depositBalances(user1.address, bnKtx.address)
    ).eq(0);

    await rewardRouterV2.connect(user1).handleRewards(
      true, // _shouldClaimKtx
      true, // _shouldStakeKtx
      true, // _shouldClaimEsKtx
      true, // _shouldStakeEsKtx
      true, // _shouldStakeMultiplierPoints
      true, // _shouldClaimWeth
      false // _shouldConvertWethToEth
    );

    expect(await ktx.balanceOf(user1.address)).eq(0);
    expect(await esKtx.balanceOf(user1.address)).eq(0);
    expect(await bnKtx.balanceOf(user1.address)).eq(0);
    expect(await klp.balanceOf(user1.address)).eq(0);
    expect(await eth.balanceOf(user1.address)).gt(expandDecimals(7, 18));
    expect(await eth.balanceOf(user1.address)).lt(expandDecimals(8, 18));

    expect(
      await stakedKtxTracker.depositBalances(user1.address, ktx.address)
    ).eq(expandDecimals(200, 18));
    expect(
      await stakedKtxTracker.depositBalances(user1.address, esKtx.address)
    ).gt(expandDecimals(3571, 18));
    expect(
      await stakedKtxTracker.depositBalances(user1.address, esKtx.address)
    ).lt(expandDecimals(3572, 18));
    expect(
      await feeKtxTracker.depositBalances(user1.address, bnKtx.address)
    ).gt("540000000000000000"); // 0.54
    expect(
      await feeKtxTracker.depositBalances(user1.address, bnKtx.address)
    ).lt("560000000000000000"); // 0.56

    await increaseTime(provider, 24 * 60 * 60);
    await mineBlock(provider);

    const ethBalance0 = await provider.getBalance(user1.address);

    await rewardRouterV2.connect(user1).handleRewards(
      false, // _shouldClaimKtx
      false, // _shouldStakeKtx
      false, // _shouldClaimEsKtx
      false, // _shouldStakeEsKtx
      false, // _shouldStakeMultiplierPoints
      true, // _shouldClaimWeth
      true // _shouldConvertWethToEth
    );

    const ethBalance1 = await provider.getBalance(user1.address);

    expect(await ethBalance1.sub(ethBalance0)).gt(expandDecimals(7, 18));
    expect(await ethBalance1.sub(ethBalance0)).lt(expandDecimals(8, 18));
    expect(await ktx.balanceOf(user1.address)).eq(0);
    expect(await esKtx.balanceOf(user1.address)).eq(0);
    expect(await bnKtx.balanceOf(user1.address)).eq(0);
    expect(await klp.balanceOf(user1.address)).eq(0);
    expect(await eth.balanceOf(user1.address)).gt(expandDecimals(7, 18));
    expect(await eth.balanceOf(user1.address)).lt(expandDecimals(8, 18));

    expect(
      await stakedKtxTracker.depositBalances(user1.address, ktx.address)
    ).eq(expandDecimals(200, 18));
    expect(
      await stakedKtxTracker.depositBalances(user1.address, esKtx.address)
    ).gt(expandDecimals(3571, 18));
    expect(
      await stakedKtxTracker.depositBalances(user1.address, esKtx.address)
    ).lt(expandDecimals(3572, 18));
    expect(
      await feeKtxTracker.depositBalances(user1.address, bnKtx.address)
    ).gt("540000000000000000"); // 0.54
    expect(
      await feeKtxTracker.depositBalances(user1.address, bnKtx.address)
    ).lt("560000000000000000"); // 0.56

    await rewardRouterV2.connect(user1).handleRewards(
      false, // _shouldClaimKtx
      false, // _shouldStakeKtx
      true, // _shouldClaimEsKtx
      false, // _shouldStakeEsKtx
      false, // _shouldStakeMultiplierPoints
      false, // _shouldClaimWeth
      false // _shouldConvertWethToEth
    );

    expect(await ethBalance1.sub(ethBalance0)).gt(expandDecimals(7, 18));
    expect(await ethBalance1.sub(ethBalance0)).lt(expandDecimals(8, 18));
    expect(await ktx.balanceOf(user1.address)).eq(0);
    expect(await esKtx.balanceOf(user1.address)).gt(expandDecimals(3571, 18));
    expect(await esKtx.balanceOf(user1.address)).lt(expandDecimals(3572, 18));
    expect(await bnKtx.balanceOf(user1.address)).eq(0);
    expect(await klp.balanceOf(user1.address)).eq(0);
    expect(await eth.balanceOf(user1.address)).gt(expandDecimals(7, 18));
    expect(await eth.balanceOf(user1.address)).lt(expandDecimals(8, 18));

    expect(
      await stakedKtxTracker.depositBalances(user1.address, ktx.address)
    ).eq(expandDecimals(200, 18));
    expect(
      await stakedKtxTracker.depositBalances(user1.address, esKtx.address)
    ).gt(expandDecimals(3571, 18));
    expect(
      await stakedKtxTracker.depositBalances(user1.address, esKtx.address)
    ).lt(expandDecimals(3572, 18));
    expect(
      await feeKtxTracker.depositBalances(user1.address, bnKtx.address)
    ).gt("540000000000000000"); // 0.54
    expect(
      await feeKtxTracker.depositBalances(user1.address, bnKtx.address)
    ).lt("560000000000000000"); // 0.56

    await ktxVester.connect(user1).deposit(expandDecimals(365, 18));
    await klpVester.connect(user1).deposit(expandDecimals(365 * 2, 18));

    expect(await ethBalance1.sub(ethBalance0)).gt(expandDecimals(7, 18));
    expect(await ethBalance1.sub(ethBalance0)).lt(expandDecimals(8, 18));
    expect(await ktx.balanceOf(user1.address)).eq(0);
    expect(await esKtx.balanceOf(user1.address)).gt(
      expandDecimals(3571 - 365 * 3, 18)
    );
    expect(await esKtx.balanceOf(user1.address)).lt(
      expandDecimals(3572 - 365 * 3, 18)
    );
    expect(await bnKtx.balanceOf(user1.address)).eq(0);
    expect(await klp.balanceOf(user1.address)).eq(0);
    expect(await eth.balanceOf(user1.address)).gt(expandDecimals(7, 18));
    expect(await eth.balanceOf(user1.address)).lt(expandDecimals(8, 18));

    expect(
      await stakedKtxTracker.depositBalances(user1.address, ktx.address)
    ).eq(expandDecimals(200, 18));
    expect(
      await stakedKtxTracker.depositBalances(user1.address, esKtx.address)
    ).gt(expandDecimals(3571, 18));
    expect(
      await stakedKtxTracker.depositBalances(user1.address, esKtx.address)
    ).lt(expandDecimals(3572, 18));
    expect(
      await feeKtxTracker.depositBalances(user1.address, bnKtx.address)
    ).gt("540000000000000000"); // 0.54
    expect(
      await feeKtxTracker.depositBalances(user1.address, bnKtx.address)
    ).lt("560000000000000000"); // 0.56

    await increaseTime(provider, 24 * 60 * 60);
    await mineBlock(provider);

    await rewardRouterV2.connect(user1).handleRewards(
      true, // _shouldClaimKtx
      false, // _shouldStakeKtx
      false, // _shouldClaimEsKtx
      false, // _shouldStakeEsKtx
      false, // _shouldStakeMultiplierPoints
      false, // _shouldClaimWeth
      false // _shouldConvertWethToEth
    );

    expect(await ethBalance1.sub(ethBalance0)).gt(expandDecimals(7, 18));
    expect(await ethBalance1.sub(ethBalance0)).lt(expandDecimals(8, 18));
    expect(await ktx.balanceOf(user1.address)).gt("2900000000000000000"); // 2.9
    expect(await ktx.balanceOf(user1.address)).lt("3100000000000000000"); // 3.1
    expect(await esKtx.balanceOf(user1.address)).gt(
      expandDecimals(3571 - 365 * 3, 18)
    );
    expect(await esKtx.balanceOf(user1.address)).lt(
      expandDecimals(3572 - 365 * 3, 18)
    );
    expect(await bnKtx.balanceOf(user1.address)).eq(0);
    expect(await klp.balanceOf(user1.address)).eq(0);
    expect(await eth.balanceOf(user1.address)).gt(expandDecimals(7, 18));
    expect(await eth.balanceOf(user1.address)).lt(expandDecimals(8, 18));

    expect(
      await stakedKtxTracker.depositBalances(user1.address, ktx.address)
    ).eq(expandDecimals(200, 18));
    expect(
      await stakedKtxTracker.depositBalances(user1.address, esKtx.address)
    ).gt(expandDecimals(3571, 18));
    expect(
      await stakedKtxTracker.depositBalances(user1.address, esKtx.address)
    ).lt(expandDecimals(3572, 18));
    expect(
      await feeKtxTracker.depositBalances(user1.address, bnKtx.address)
    ).gt("540000000000000000"); // 0.54
    expect(
      await feeKtxTracker.depositBalances(user1.address, bnKtx.address)
    ).lt("560000000000000000"); // 0.56
  });

  it("StakedKlp", async () => {
    await eth.mint(feeKlpDistributor.address, expandDecimals(100, 18));
    await feeKlpDistributor.setTokensPerInterval("41335970000000"); // 0.00004133597 ETH per second

    await bnb.mint(user1.address, expandDecimals(1, 18));
    await bnb.connect(user1).approve(klpManager.address, expandDecimals(1, 18));
    await rewardRouter
      .connect(user1)
      .mintAndStakeKlp(
        bnb.address,
        expandDecimals(1, 18),
        expandDecimals(299, 18),
        expandDecimals(299, 18)
      );

    expect(await feeKlpTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(2991, 17)
    );
    expect(await feeKlpTracker.depositBalances(user1.address, klp.address)).eq(
      expandDecimals(2991, 17)
    );

    expect(await stakedKlpTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(2991, 17)
    );
    expect(
      await stakedKlpTracker.depositBalances(
        user1.address,
        feeKlpTracker.address
      )
    ).eq(expandDecimals(2991, 17));

    const stakedKlp = await deployContract("StakedKlp", [
      klp.address,
      klpManager.address,
      stakedKlpTracker.address,
      feeKlpTracker.address,
    ]);

    await expect(
      stakedKlp
        .connect(user2)
        .transferFrom(user1.address, user3.address, expandDecimals(2991, 17))
    ).to.be.revertedWith("StakedKlp: transfer amount exceeds allowance");

    await stakedKlp
      .connect(user1)
      .approve(user2.address, expandDecimals(2991, 17));

    await expect(
      stakedKlp
        .connect(user2)
        .transferFrom(user1.address, user3.address, expandDecimals(2991, 17))
    ).to.be.revertedWith("StakedKlp: cooldown duration not yet passed");

    await increaseTime(provider, 24 * 60 * 60 + 10);
    await mineBlock(provider);

    await expect(
      stakedKlp
        .connect(user2)
        .transferFrom(user1.address, user3.address, expandDecimals(2991, 17))
    ).to.be.revertedWith("RewardTracker: forbidden");

    await timelock.signalSetHandler(
      stakedKlpTracker.address,
      stakedKlp.address,
      true
    );
    await increaseTime(provider, 20);
    await mineBlock(provider);
    await timelock.setHandler(
      stakedKlpTracker.address,
      stakedKlp.address,
      true
    );

    await expect(
      stakedKlp
        .connect(user2)
        .transferFrom(user1.address, user3.address, expandDecimals(2991, 17))
    ).to.be.revertedWith("RewardTracker: forbidden");

    await timelock.signalSetHandler(
      feeKlpTracker.address,
      stakedKlp.address,
      true
    );
    await increaseTime(provider, 20);
    await mineBlock(provider);
    await timelock.setHandler(feeKlpTracker.address, stakedKlp.address, true);

    expect(await feeKlpTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(2991, 17)
    );
    expect(await feeKlpTracker.depositBalances(user1.address, klp.address)).eq(
      expandDecimals(2991, 17)
    );

    expect(await stakedKlpTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(2991, 17)
    );
    expect(
      await stakedKlpTracker.depositBalances(
        user1.address,
        feeKlpTracker.address
      )
    ).eq(expandDecimals(2991, 17));

    expect(await feeKlpTracker.stakedAmounts(user3.address)).eq(0);
    expect(await feeKlpTracker.depositBalances(user3.address, klp.address)).eq(
      0
    );

    expect(await stakedKlpTracker.stakedAmounts(user3.address)).eq(0);
    expect(
      await stakedKlpTracker.depositBalances(
        user3.address,
        feeKlpTracker.address
      )
    ).eq(0);

    await stakedKlp
      .connect(user2)
      .transferFrom(user1.address, user3.address, expandDecimals(2991, 17));

    expect(await feeKlpTracker.stakedAmounts(user1.address)).eq(0);
    expect(await feeKlpTracker.depositBalances(user1.address, klp.address)).eq(
      0
    );

    expect(await stakedKlpTracker.stakedAmounts(user1.address)).eq(0);
    expect(
      await stakedKlpTracker.depositBalances(
        user1.address,
        feeKlpTracker.address
      )
    ).eq(0);

    expect(await feeKlpTracker.stakedAmounts(user3.address)).eq(
      expandDecimals(2991, 17)
    );
    expect(await feeKlpTracker.depositBalances(user3.address, klp.address)).eq(
      expandDecimals(2991, 17)
    );

    expect(await stakedKlpTracker.stakedAmounts(user3.address)).eq(
      expandDecimals(2991, 17)
    );
    expect(
      await stakedKlpTracker.depositBalances(
        user3.address,
        feeKlpTracker.address
      )
    ).eq(expandDecimals(2991, 17));

    await expect(
      stakedKlp
        .connect(user2)
        .transferFrom(user3.address, user1.address, expandDecimals(3000, 17))
    ).to.be.revertedWith("StakedKlp: transfer amount exceeds allowance");

    await stakedKlp
      .connect(user3)
      .approve(user2.address, expandDecimals(3000, 17));

    await expect(
      stakedKlp
        .connect(user2)
        .transferFrom(user3.address, user1.address, expandDecimals(3000, 17))
    ).to.be.revertedWith("RewardTracker: _amount exceeds stakedAmount");

    await stakedKlp
      .connect(user2)
      .transferFrom(user3.address, user1.address, expandDecimals(1000, 17));

    expect(await feeKlpTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(1000, 17)
    );
    expect(await feeKlpTracker.depositBalances(user1.address, klp.address)).eq(
      expandDecimals(1000, 17)
    );

    expect(await stakedKlpTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(1000, 17)
    );
    expect(
      await stakedKlpTracker.depositBalances(
        user1.address,
        feeKlpTracker.address
      )
    ).eq(expandDecimals(1000, 17));

    expect(await feeKlpTracker.stakedAmounts(user3.address)).eq(
      expandDecimals(1991, 17)
    );
    expect(await feeKlpTracker.depositBalances(user3.address, klp.address)).eq(
      expandDecimals(1991, 17)
    );

    expect(await stakedKlpTracker.stakedAmounts(user3.address)).eq(
      expandDecimals(1991, 17)
    );
    expect(
      await stakedKlpTracker.depositBalances(
        user3.address,
        feeKlpTracker.address
      )
    ).eq(expandDecimals(1991, 17));

    await stakedKlp
      .connect(user3)
      .transfer(user1.address, expandDecimals(1500, 17));

    expect(await feeKlpTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(2500, 17)
    );
    expect(await feeKlpTracker.depositBalances(user1.address, klp.address)).eq(
      expandDecimals(2500, 17)
    );

    expect(await stakedKlpTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(2500, 17)
    );
    expect(
      await stakedKlpTracker.depositBalances(
        user1.address,
        feeKlpTracker.address
      )
    ).eq(expandDecimals(2500, 17));

    expect(await feeKlpTracker.stakedAmounts(user3.address)).eq(
      expandDecimals(491, 17)
    );
    expect(await feeKlpTracker.depositBalances(user3.address, klp.address)).eq(
      expandDecimals(491, 17)
    );

    expect(await stakedKlpTracker.stakedAmounts(user3.address)).eq(
      expandDecimals(491, 17)
    );
    expect(
      await stakedKlpTracker.depositBalances(
        user3.address,
        feeKlpTracker.address
      )
    ).eq(expandDecimals(491, 17));

    await expect(
      stakedKlp.connect(user3).transfer(user1.address, expandDecimals(492, 17))
    ).to.be.revertedWith("RewardTracker: _amount exceeds stakedAmount");

    expect(await bnb.balanceOf(user1.address)).eq(0);

    await rewardRouter.connect(user1).unstakeAndRedeemKlp(
      bnb.address,
      expandDecimals(2500, 17),
      "830000000000000000", // 0.83
      user1.address
    );

    expect(await bnb.balanceOf(user1.address)).eq("830833333333333333");

    await usdg.addVault(klpManager.address);

    expect(await bnb.balanceOf(user3.address)).eq("0");

    await rewardRouter.connect(user3).unstakeAndRedeemKlp(
      bnb.address,
      expandDecimals(491, 17),
      "160000000000000000", // 0.16
      user3.address
    );

    expect(await bnb.balanceOf(user3.address)).eq("163175666666666666");
  });

  it("FeeKlp", async () => {
    await eth.mint(feeKlpDistributor.address, expandDecimals(100, 18));
    await feeKlpDistributor.setTokensPerInterval("41335970000000"); // 0.00004133597 ETH per second

    await bnb.mint(user1.address, expandDecimals(1, 18));
    await bnb.connect(user1).approve(klpManager.address, expandDecimals(1, 18));
    await rewardRouter
      .connect(user1)
      .mintAndStakeKlp(
        bnb.address,
        expandDecimals(1, 18),
        expandDecimals(299, 18),
        expandDecimals(299, 18)
      );

    expect(await feeKlpTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(2991, 17)
    );
    expect(await feeKlpTracker.depositBalances(user1.address, klp.address)).eq(
      expandDecimals(2991, 17)
    );

    expect(await stakedKlpTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(2991, 17)
    );
    expect(
      await stakedKlpTracker.depositBalances(
        user1.address,
        feeKlpTracker.address
      )
    ).eq(expandDecimals(2991, 17));

    const klpBalance = await deployContract("KlpBalance", [
      klpManager.address,
      stakedKlpTracker.address,
    ]);

    await expect(
      klpBalance
        .connect(user2)
        .transferFrom(user1.address, user3.address, expandDecimals(2991, 17))
    ).to.be.revertedWith("KlpBalance: transfer amount exceeds allowance");

    await klpBalance
      .connect(user1)
      .approve(user2.address, expandDecimals(2991, 17));

    await expect(
      klpBalance
        .connect(user2)
        .transferFrom(user1.address, user3.address, expandDecimals(2991, 17))
    ).to.be.revertedWith("KlpBalance: cooldown duration not yet passed");

    await increaseTime(provider, 24 * 60 * 60 + 10);
    await mineBlock(provider);

    await expect(
      klpBalance
        .connect(user2)
        .transferFrom(user1.address, user3.address, expandDecimals(2991, 17))
    ).to.be.revertedWith("RewardTracker: transfer amount exceeds allowance");

    await timelock.signalSetHandler(
      stakedKlpTracker.address,
      klpBalance.address,
      true
    );
    await increaseTime(provider, 20);
    await mineBlock(provider);
    await timelock.setHandler(
      stakedKlpTracker.address,
      klpBalance.address,
      true
    );

    expect(await feeKlpTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(2991, 17)
    );
    expect(await feeKlpTracker.depositBalances(user1.address, klp.address)).eq(
      expandDecimals(2991, 17)
    );

    expect(await stakedKlpTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(2991, 17)
    );
    expect(
      await stakedKlpTracker.depositBalances(
        user1.address,
        feeKlpTracker.address
      )
    ).eq(expandDecimals(2991, 17));
    expect(await stakedKlpTracker.balanceOf(user1.address)).eq(
      expandDecimals(2991, 17)
    );

    expect(await feeKlpTracker.stakedAmounts(user3.address)).eq(0);
    expect(await feeKlpTracker.depositBalances(user3.address, klp.address)).eq(
      0
    );

    expect(await stakedKlpTracker.stakedAmounts(user3.address)).eq(0);
    expect(
      await stakedKlpTracker.depositBalances(
        user3.address,
        feeKlpTracker.address
      )
    ).eq(0);
    expect(await stakedKlpTracker.balanceOf(user3.address)).eq(0);

    await klpBalance
      .connect(user2)
      .transferFrom(user1.address, user3.address, expandDecimals(2991, 17));

    expect(await feeKlpTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(2991, 17)
    );
    expect(await feeKlpTracker.depositBalances(user1.address, klp.address)).eq(
      expandDecimals(2991, 17)
    );

    expect(await stakedKlpTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(2991, 17)
    );
    expect(
      await stakedKlpTracker.depositBalances(
        user1.address,
        feeKlpTracker.address
      )
    ).eq(expandDecimals(2991, 17));
    expect(await stakedKlpTracker.balanceOf(user1.address)).eq(0);

    expect(await feeKlpTracker.stakedAmounts(user3.address)).eq(0);
    expect(await feeKlpTracker.depositBalances(user3.address, klp.address)).eq(
      0
    );

    expect(await stakedKlpTracker.stakedAmounts(user3.address)).eq(0);
    expect(
      await stakedKlpTracker.depositBalances(
        user3.address,
        feeKlpTracker.address
      )
    ).eq(0);
    expect(await stakedKlpTracker.balanceOf(user3.address)).eq(
      expandDecimals(2991, 17)
    );

    await expect(
      rewardRouter
        .connect(user1)
        .unstakeAndRedeemKlp(
          bnb.address,
          expandDecimals(2991, 17),
          "0",
          user1.address
        )
    ).to.be.revertedWith("RewardTracker: burn amount exceeds balance");

    await klpBalance
      .connect(user3)
      .approve(user2.address, expandDecimals(3000, 17));

    await expect(
      klpBalance
        .connect(user2)
        .transferFrom(user3.address, user1.address, expandDecimals(2992, 17))
    ).to.be.revertedWith("RewardTracker: transfer amount exceeds balance");

    await klpBalance
      .connect(user2)
      .transferFrom(user3.address, user1.address, expandDecimals(2991, 17));

    expect(await bnb.balanceOf(user1.address)).eq(0);

    await rewardRouter
      .connect(user1)
      .unstakeAndRedeemKlp(
        bnb.address,
        expandDecimals(2991, 17),
        "0",
        user1.address
      );

    expect(await bnb.balanceOf(user1.address)).eq("994009000000000000");
  });
});
