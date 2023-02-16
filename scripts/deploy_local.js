const { expect, use } = require("chai");
const { solidity } = require("ethereum-waffle");
const {
  expandDecimals,
  getBlockTime,
  increaseTime,
  mineBlock,
  reportGasUsed,
  newWallet,
} = require("./shared/utilities");
const { toChainlinkPrice } = require("./shared/chainlink");
const { toUsd, toNormalizedPrice } = require("./shared/units");
const {
  initVault,
  getBnbConfig,
  getBtcConfig,
  getDaiConfig,
  getEthConfig,
} = require("./helpers");
const {
  getFrameSigner,
  deployContract,
  contractAt,
  sendTxn,
  writeTmpAddresses,
} = require("./shared/helpers");
const { errors } = require("../test/core/Vault/helpers");
const { network } = require("hardhat");

const partnerContracts = [
  "0x46a208f987F2002899bA37b2A32a394D34F30a88", // nj
  "0xc0271BDA95f78EF80728152eE9B6c5A915E91DA5", // rs
  "0xAa7E7f2532d0C8B642027844e654F32C40A9e36a", // rs
  "0x16740dAC5E7fe366e741D0622F8f570Af671738d", // ke
  "0x577BdeD1b0686D7e00ED6208e7Db8B098f23949b", // ke
  "0xab22E9da996D874CA0026f531e61472B55af33AE", // ll
  "0x882304271Ee4851133005f817AF762f97D9dbd07", // ll
];
const minter = [
  "0x46a208f987F2002899bA37b2A32a394D34F30a88", // nj
];

let signers = [
  "0x46a208f987F2002899bA37b2A32a394D34F30a88", // nj
  "0xc0271BDA95f78EF80728152eE9B6c5A915E91DA5", // rs
  "0xAa7E7f2532d0C8B642027844e654F32C40A9e36a", // rs
  "0x16740dAC5E7fe366e741D0622F8f570Af671738d", // ke
  "0x577BdeD1b0686D7e00ED6208e7Db8B098f23949b", // ke
  "0xab22E9da996D874CA0026f531e61472B55af33AE", // ll
  "0x882304271Ee4851133005f817AF762f97D9dbd07", // ll
];

const updaters = [
  "0x46a208f987F2002899bA37b2A32a394D34F30a88", // nj
  "0xc0271BDA95f78EF80728152eE9B6c5A915E91DA5", // rs
  "0xAa7E7f2532d0C8B642027844e654F32C40A9e36a", // rs
  "0x16740dAC5E7fe366e741D0622F8f570Af671738d", // ke
  "0x577BdeD1b0686D7e00ED6208e7Db8B098f23949b", // ke
  "0xab22E9da996D874CA0026f531e61472B55af33AE", // ll
  "0x882304271Ee4851133005f817AF762f97D9dbd07", // ll
];

const maxTokenSupply = expandDecimals("100000000", 18);

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function deployTokenManager() {
  const tokenManager = await deployContract(
    "TokenManager",
    [1],
    "TokenManager"
  );

  if (network.name == "localhost") {
    const signer = await getFrameSigner();
    signers = [signer.address];
  }

  await sendTxn(tokenManager.initialize(signers), "tokenManager.initialize");
  return tokenManager;
}

async function deployOrderBook(tokens, router, vault, usdg) {
  const { wbnb } = tokens;

  const orderBook = await deployContract("OrderBook", []);

  // Arbitrum mainnet addresses
  await sendTxn(
    orderBook.initialize(
      router.address, // router
      vault.address, // vault
      wbnb.address, // weth
      usdg.address, // usdg
      "2000000000000000", // 0.002 BNB
      expandDecimals(10, 30) // min purchase token amount usd
    ),
    "orderBook.initialize"
  );

  writeTmpAddresses({
    orderBook: orderBook.address,
  });
  return orderBook;
}

async function deployOrderExecutor(vault, orderBook) {
  return await deployContract("OrderExecutor", [
    vault.address,
    orderBook.address,
  ]);
}

async function deployPositionManager(vault, router, wbnb, orderBook) {
  const depositFee = 50;
  const positionManager = await deployContract("PositionManager", [
    vault.address,
    router.address,
    wbnb.address,
    depositFee,
    orderBook.address,
  ]);
  const signer = await getFrameSigner();
  await sendTxn(
    positionManager.setOrderKeeper(signer.address, true),
    "positionManager.setOrderKeeper(signer)"
  );
  await sendTxn(
    positionManager.setLiquidator(signer.address, true),
    "positionManager.setLiquidator(liquidator)"
  );
  await sendTxn(
    router.addPlugin(positionManager.address),
    "router.addPlugin(positionManager)"
  );

  for (let i = 0; i < partnerContracts.length; i++) {
    const partnerContract = partnerContracts[i];
    await sendTxn(
      positionManager.setPartner(partnerContract, true),
      "positionManager.setPartner(partnerContract)"
    );
  }
  return positionManager;
}

async function deployPositionRouter(vault, router, wbnb) {
  const depositFee = 30; // 0.3%
  const minExecutionFee = 1600000000000000; // 0.0016 BNB
  const positionRouter = await deployContract("PositionRouter", [
    vault.address,
    router.address,
    wbnb.address,
    depositFee,
    minExecutionFee,
  ]);
  const referralStorage = await deployContract("ReferralStorage", []);

  await sendTxn(
    positionRouter.setReferralStorage(referralStorage.address),
    "positionRouter.setReferralStorage"
  );
  await sendTxn(
    referralStorage.setHandler(positionRouter.address, true),
    "referralStorage.setHandler(positionRouter)"
  );

  await sendTxn(router.addPlugin(positionRouter.address), "router.addPlugin");

  await sendTxn(
    positionRouter.setDelayValues(1, 180, 30 * 60),
    "positionRouter.setDelayValues"
  );
  // await sendTxn(
  //   timelock.setContractHandler(positionRouter.address, true),
  //   "timelock.setContractHandler(positionRouter)"
  // );
  return [referralStorage, positionRouter];
}

async function setVaultTokenConfig(
  vault,
  vaultPriceFeed,
  tokens,
  ethPriceFeed,
  btcPriceFeed,
  bnbPriceFeed,
  busdPriceFeed,
  usdtPriceFeed
) {
  // const provider = ethers.provider;
  await vaultPriceFeed.setTokenConfig(
    tokens.usdt.address, // _token
    usdtPriceFeed.address, // _priceFeed
    8, // _priceDecimals
    true // _isStrictStable
  );
  await vaultPriceFeed.setTokenConfig(
    tokens.busd.address, // _token
    busdPriceFeed.address, // _priceFeed
    8, // _priceDecimals
    true // _isStrictStable
  );
  await vaultPriceFeed.setTokenConfig(
    tokens.eth.address, // _token
    ethPriceFeed.address, // _priceFeed
    8, // _priceDecimals
    false // _isStrictStable
  );
  await vaultPriceFeed.setTokenConfig(
    tokens.btc.address, // _token
    btcPriceFeed.address, // _priceFeed
    8, // _priceDecimals
    false // _isStrictStable
  );
  await vaultPriceFeed.setTokenConfig(
    tokens.bnb.address, // _token
    bnbPriceFeed.address, // _priceFeed
    8, // _priceDecimals
    false // _isStrictStable
  );
  await vault.setIsSwapEnabled(true);
  console.log("start to update price");
  await ethPriceFeed.setLatestAnswer(toChainlinkPrice(1500));
  await btcPriceFeed.setLatestAnswer(toChainlinkPrice(20000));
  await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300));
  await busdPriceFeed.setLatestAnswer(toChainlinkPrice(1));
  await usdtPriceFeed.setLatestAnswer(toChainlinkPrice(1));
  console.log("start to setTokenConfig");
  await sleep(5000);
  let tokenArr = [tokens.usdt, tokens.busd, tokens.eth, tokens.bnb, tokens.btc];
  for (i = 0; i < tokenArr.length; i++) {
    await sleep(5000);
    await sendTxn(
      vault.setTokenConfig(
        tokenArr[i].address,
        tokenArr[i].decimals,
        tokenArr[i].tokenWeight,
        tokenArr[i].minProfitBps,
        expandDecimals(tokenArr[i].maxUsdgAmount, 18),
        tokenArr[i].isStable,
        tokenArr[i].isShortable
      ),
      "vault.setTokenConfig"
    );
  }
  // await vault.setTokenConfig(...getEthConfig(eth, ethPriceFeed));
  // await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed));
  // await vault.setTokenConfig(...getBnbConfig(bnb, bnbPriceFeed));
  // await vault.setTokenConfig(...getDaiConfig(busd, busdPriceFeed));
}

// TODO: fix price feed
async function deployPriceFeed(
  vault,
  tokens,
  timelock,
  tokenManager,
  positionRouter,
  vaultPriceFeed,
  positionManager
) {
  const { btc, eth, bnb, busd, usdt } = tokens;
  const tokenArr = [btc, eth, bnb, busd, usdt];
  const fastPriceTokens = [btc, eth, bnb, busd, usdt];
  if (fastPriceTokens.find((t) => !t.fastPricePrecision)) {
    throw new Error("Invalid price precision");
  }

  if (fastPriceTokens.find((t) => !t.maxCumulativeDeltaDiff)) {
    throw new Error("Invalid price maxCumulativeDeltaDiff");
  }

  const signer = await getFrameSigner();

  const fastPriceEvents = await deployContract("FastPriceEvents", []);

  const secondaryPriceFeed = await deployContract("FastPriceFeed", [
    5 * 60, // _priceDuration
    // 60 * 60, // _maxPriceUpdateDelay
    0, // _minBlockInterval
    750, // _maxDeviationBasisPoints
    fastPriceEvents.address, // _fastPriceEvents
    tokenManager.address, // _tokenManager
    positionRouter.address,
  ]);

  await sendTxn(
    secondaryPriceFeed.initialize(1, signers, updaters),
    "secondaryPriceFeed.initialize"
  );
  await sendTxn(
    secondaryPriceFeed.setMaxTimeDeviation(60 * 60),
    "secondaryPriceFeed.setMaxTimeDeviation"
  );

  await sendTxn(
    positionRouter.setPositionKeeper(secondaryPriceFeed.address, true),
    "positionRouter.setPositionKeeper(secondaryPriceFeed)"
  );

  await sendTxn(
    fastPriceEvents.setIsPriceFeed(secondaryPriceFeed.address, true),
    "fastPriceEvents.setIsPriceFeed"
  );

  await sendTxn(
    vaultPriceFeed.setMaxStrictPriceDeviation(expandDecimals(1, 28)),
    "vaultPriceFeed.setMaxStrictPriceDeviation"
  ); // 0.05 USD
  await sendTxn(
    vaultPriceFeed.setPriceSampleSpace(1),
    "vaultPriceFeed.setPriceSampleSpace"
  );
  await sendTxn(
    vaultPriceFeed.setSecondaryPriceFeed(secondaryPriceFeed.address),
    "vaultPriceFeed.setSecondaryPriceFeed"
  );
  await sendTxn(
    vaultPriceFeed.setIsAmmEnabled(false),
    "vaultPriceFeed.setIsAmmEnabled"
  );
  // await sendTxn(
  //   priceFeedTimelock.setChainlinkFlags(chainlinkFlags.address),
  //   "vaultPriceFeed.setChainlinkFlags"
  // );
  for (const token of tokenArr) {
    await sendTxn(
      vaultPriceFeed.setTokenConfig(
        token.address, // _token
        token.priceFeed, // _priceFeed
        token.priceDecimals, // _priceDecimals
        token.isStrictStable // _isStrictStable
      ),
      `vaultPriceFeed.setTokenConfig(${token.name}) ${token.address} ${token.priceFeed}`
    );
  }

  await sendTxn(
    secondaryPriceFeed.setTokens(
      fastPriceTokens.map((t) => t.address),
      fastPriceTokens.map((t) => t.fastPricePrecision)
    ),
    "secondaryPriceFeed.setTokens"
  );
  await sendTxn(
    secondaryPriceFeed.setMaxTimeDeviation(60 * 60),
    "secondaryPriceFeed.setMaxTimeDeviation"
  );
  await sendTxn(
    vault.setPriceFeed(vaultPriceFeed.address),
    "vault.setPriceFeed"
  );
  await sendTxn(
    vault.setIsLeverageEnabled(true),
    "vault.setIsLeverageEnabled(true)"
  );
  await sendTxn(secondaryPriceFeed.setUpdater(signer.address, true));

  await sendTxn(
    vault.setLiquidator(positionManager.address, true),
    "vault.setLiquidator(positionManager.address, true)"
  );
  return [fastPriceEvents, secondaryPriceFeed];
}

async function deployVault(tokens) {
  const { bnb, btc, eth, busd, usdt, wbnb } = tokens;
  const tokenArr = [btc, eth, bnb, busd, usdt];
  const vault = await deployContract("Vault", []);
  await vault.deployed();
  const usdg = await deployContract("USDG", [vault.address]);
  await usdg.deployed();
  const router = await deployContract("Router", [
    vault.address,
    usdg.address,
    wbnb.address,
  ]);
  await router.deployed();
  // const router = await contractAt("Router", "0xaBBc5F99639c9B6bCb58544ddf04EFA6802F4064")
  // const vaultPriceFeed = await contractAt("VaultPriceFeed", "0x30333ce00ac3025276927672aaefd80f22e89e54")
  // const secondaryPriceFeed = await deployContract("FastPriceFeed", [5 * 60])

  const vaultPriceFeed = await deployContract("VaultPriceFeed", []);
  await vaultPriceFeed.deployed();

  await sendTxn(
    vaultPriceFeed.setMaxStrictPriceDeviation(expandDecimals(1, 28)),
    "vaultPriceFeed.setMaxStrictPriceDeviation"
  ); // 0.05 USD
  await sendTxn(
    vaultPriceFeed.setPriceSampleSpace(1),
    "vaultPriceFeed.setPriceSampleSpace"
  );
  await sendTxn(
    vaultPriceFeed.setIsAmmEnabled(false),
    "vaultPriceFeed.setIsAmmEnabled"
  );
  await sendTxn(
    vaultPriceFeed.setIsSecondaryPriceEnabled(true),
    "vaultPriceFeed.setIsSecondaryPriceEnabled"
  );
  await sendTxn(
    vaultPriceFeed.setUseV2Pricing(true),
    "vaultPriceFeed.setUseV2Pricing(true)"
  );
  for (let i = 0; i < tokenArr.length; i++) {
    await vaultPriceFeed.setSpreadBasisPoints(tokenArr[i].address, 0);
  }
  const klp = await deployContract("KLP", []);
  await sendTxn(
    klp.setInPrivateTransferMode(true),
    "klp.setInPrivateTransferMode"
  );
  // const klp = await contractAt("KLP", "0x4277f8F2c384827B5273592FF7CeBd9f2C1ac258")
  const shortsTracker = await deployShortsTracker(vault);

  const klpManager = await deployContract("KlpManager", [
    vault.address,
    usdg.address,
    klp.address,
    shortsTracker.address,
    15 * 60,
  ]);
  await sendTxn(
    klpManager.setInPrivateMode(true),
    "klpManager.setInPrivateMode"
  );

  await sendTxn(
    klpManager.setShortsTrackerAveragePriceWeight(10000),
    "klpManager.setShortsTrackerAveragePriceWeight(10000)"
  );

  await sendTxn(klp.setMinter(klpManager.address, true), "klp.setMinter");
  await sendTxn(usdg.addVault(klpManager.address), "usdg.addVault(klpManager)");

  await sendTxn(
    vault.initialize(
      router.address, // router
      usdg.address, // usdg
      vaultPriceFeed.address, // priceFeed
      toUsd(2), // liquidationFeeUsd
      100000, // fundingRateFactor
      100000 // stableFundingRateFactor
    ),
    "vault.initialize"
  );

  await sendTxn(vault.setFundingRate(36, 1000, 1000), "vault.setFundingRate");

  await sendTxn(vault.setInManagerMode(true), "vault.setInManagerMode");
  await sendTxn(vault.setManager(klpManager.address, true), "vault.setManager");

  await sendTxn(
    vault.setFees(
      10, // _taxBasisPoints
      5, // _stableTaxBasisPoints
      20, // _mintBurnFeeBasisPoints
      20, // _swapFeeBasisPoints
      1, // _stableSwapFeeBasisPoints
      10, // _marginFeeBasisPoints
      toUsd(2), // _liquidationFeeUsd
      24 * 60 * 60, // _minProfitTime
      true // _hasDynamicFees
    ),
    "vault.setFees"
  );

  const vaultErrorController = await deployContract("VaultErrorController", []);
  await sendTxn(
    vault.setErrorController(vaultErrorController.address),
    "vault.setErrorController"
  );
  await sendTxn(
    vaultErrorController.setErrors(vault.address, errors),
    "vaultErrorController.setErrors"
  );

  const vaultUtils = await deployContract("VaultUtils", [vault.address]);
  await sendTxn(vault.setVaultUtils(vaultUtils.address), "vault.setVaultUtils");

  return [
    vault,
    usdg,
    router,
    vaultPriceFeed,
    klp,
    klpManager,
    vaultUtils,
    shortsTracker,
  ];
}

async function deployShortsTracker(vault) {
  const shortsTracker = await deployContract(
    "ShortsTracker",
    [vault.address],
    "ShortsTracker"
  );

  return shortsTracker;
}

async function deployKtx() {
  const ktx = await deployContract("KTX", []);
  for (let i = 0; i < minter.length; i++) {
    await sendTxn(
      ktx.setMinter(minter[i], true),
      `ktx.setMinter: ${minter[i]}`
    );
  }
  const esKtx = await deployContract("EsKTX", []);
  const bnKtx = await deployContract("MintableBaseToken", [
    "Bonus KTX",
    "bnKTX",
    0,
  ]);
  return [ktx, esKtx, bnKtx];
}

async function deployBalanceUpdater() {
  const balanceUpdater = await deployContract("BalanceUpdater", []);
  return balanceUpdater;
}

async function deployBatchSender() {
  const batchSender = await deployContract("BatchSender", []);
  return batchSender;
}

async function deployEsKtxBatchSender(esKtx) {
  const esKtxBatchSender = await deployContract("EsKtxBatchSender", [
    esKtx.address,
  ]);

  return esKtxBatchSender;
}

async function deployKtxTimelock(tokenManager, rewardManager) {
  const buffer = 24 * 60 * 60;
  // const buffer = 5;
  const longBuffer = 7 * 24 * 60 * 60;
  // const longBuffer = 10;
  const mintReceiver = tokenManager;
  // const mintReceiver = { address: AddressZero };
  const signer = await getFrameSigner();
  const ktxTimelock = await deployContract(
    "KtxTimelock",
    [
      signer.address,
      buffer,
      longBuffer,
      rewardManager.address,
      tokenManager.address,
      mintReceiver.address,
      maxTokenSupply,
    ],
    "KtxTimelock"
    // { gasLimit: 100000000 }
  );
  return ktxTimelock;
}

async function deployOrderBookReader() {
  const orderBookReader = await deployContract("OrderBookReader", []);

  writeTmpAddresses({
    orderBookReader: orderBookReader.address,
  });
  return orderBookReader;
}

async function deployReader() {
  const reader = await deployContract("Reader", [], "Reader");

  writeTmpAddresses({
    reader: reader.address,
  });
  return reader;
}

async function deployRewardReader() {
  const rewardReader = await deployContract("RewardReader", [], "RewardReader");
  return rewardReader;
}

async function deployTimeLock(
  tokenManager,
  klpManager,
  rewardRouter,
  positionRouter,
  positionManager,
  rewardManager
) {
  const signer = await getFrameSigner();

  // const buffer = 5;
  const buffer = 24 * 60 * 60;

  const mintReceiver = tokenManager;

  const timelock = await deployContract(
    "Timelock",
    [
      signer.address,
      buffer,
      tokenManager.address,
      mintReceiver.address,
      klpManager.address,
      rewardRouter.address,
      rewardManager.address,
      maxTokenSupply,
      10, // marginFeeBasisPoints 0.1%
      100, // maxMarginFeeBasisPoints 1%
    ],
    "Timelock"
  );
  await timelock.deployed();
  const deployedTimelock = await contractAt(
    "Timelock",
    timelock.address,
    signer
  );

  await sendTxn(
    deployedTimelock.setContractHandler(positionRouter.address, true),
    "deployedTimelock.setContractHandler(positionRouter)"
  );
  await sendTxn(
    deployedTimelock.setShouldToggleIsLeverageEnabled(true),
    "deployedTimelock.setShouldToggleIsLeverageEnabled(true)"
  );
  await sendTxn(
    deployedTimelock.setContractHandler(positionManager.address, true),
    "deployedTimelock.setContractHandler(positionManager)"
  );

  // // update gov of vault
  // const vaultGov = await contractAt("Timelock", await vault.gov(), signer);

  // await sendTxn(
  //   vaultGov.signalSetGov(vault.address, deployedTimelock.address),
  //   "vaultGov.signalSetGov"
  // );
  // await sendTxn(
  //   deployedTimelock.signalSetGov(vault.address, vaultGov.address),
  //   "deployedTimelock.signalSetGov(vault)"
  // );
  // await sendTxn(
  //   timelock.setVaultUtils(vault.address, vaultUtils.address),
  //   "timelock.setVaultUtils"
  // );

  for (let i = 0; i < signers.length; i++) {
    const signer = signers[i];
    await sendTxn(
      deployedTimelock.setContractHandler(signer, true),
      `deployedTimelock.setContractHandler(${signer})`
    );
  }

  // const keepers = [
  //   "0x46a208f987F2002899bA37b2A32a394D34F30a88", // nj
  //   "0xc0271BDA95f78EF80728152eE9B6c5A915E91DA5", // rs
  //   "0xc0271BDA95f78EF80728152eE9B6c5A915E91DA5", // ke
  // ];

  // for (let i = 0; i < keepers.length; i++) {
  //   const keeper = keepers[i];
  //   await sendTxn(
  //     deployedTimelock.setKeeper(keeper, true),
  //     `deployedTimelock.setKeeper(${keeper})`
  //   );
  // }

  await sendTxn(
    deployedTimelock.setContractHandler(positionManager.address, true),
    "deployedTimelock.setContractHandler(positionManager)"
  );

  return timelock;
}

async function deployVaultReader() {
  const vaultReader = await deployContract("VaultReader", [], "VaultReader");

  writeTmpAddresses({
    reader: vaultReader.address,
  });

  return vaultReader;
}

async function deployStakedKlp(
  klp,
  klpManager,
  stakedKlpTracker,
  feeKlpTracker
) {
  const stakedKlp = await deployContract("StakedKlp", [
    klp.address,
    klpManager.address,
    stakedKlpTracker.address,
    feeKlpTracker.address,
  ]);

  const klpBalance = await deployContract("KlpBalance", [
    klpManager.address,
    stakedKlpTracker.address,
  ]);

  return [stakedKlp, klpBalance];
}

async function deployRewardRouter(
  tokens,
  klpManager,
  klp,
  ktx,
  esKtx,
  bnKtx,
  timelock
) {
  const { wbnb } = tokens;

  const vestingDuration = 365 * 24 * 60 * 60;
  await sendTxn(
    esKtx.setInPrivateTransferMode(true),
    "esKtx.setInPrivateTransferMode"
  );
  await sendTxn(
    klp.setInPrivateTransferMode(true),
    "klp.setInPrivateTransferMode"
  );

  const stakedKtxTracker = await deployContract("RewardTracker", [
    "Staked KTX",
    "sKTX",
  ]);
  const stakedKtxDistributor = await deployContract("RewardDistributor", [
    esKtx.address,
    stakedKtxTracker.address,
  ]);
  await sendTxn(
    stakedKtxTracker.initialize(
      [ktx.address, esKtx.address],
      stakedKtxDistributor.address
    ),
    "stakedKtxTracker.initialize"
  );
  await sendTxn(
    stakedKtxDistributor.updateLastDistributionTime(),
    "stakedKtxDistributor.updateLastDistributionTime"
  );

  const bonusKtxTracker = await deployContract("RewardTracker", [
    "Staked + Bonus KTX",
    "sbKTX",
  ]);
  const bonusKtxDistributor = await deployContract("BonusDistributor", [
    bnKtx.address,
    bonusKtxTracker.address,
  ]);
  await sendTxn(
    bonusKtxTracker.initialize(
      [stakedKtxTracker.address],
      bonusKtxDistributor.address
    ),
    "bonusKtxTracker.initialize"
  );
  await sendTxn(
    bonusKtxDistributor.updateLastDistributionTime(),
    "bonusKtxDistributor.updateLastDistributionTime"
  );

  const feeKtxTracker = await deployContract("RewardTracker", [
    "Staked + Bonus + Fee KTX",
    "sbfKTX",
  ]);
  const feeKtxDistributor = await deployContract("RewardDistributor", [
    wbnb.address,
    feeKtxTracker.address,
  ]);
  await sendTxn(
    feeKtxTracker.initialize(
      [bonusKtxTracker.address, bnKtx.address],
      feeKtxDistributor.address
    ),
    "feeKtxTracker.initialize"
  );
  await sendTxn(
    feeKtxDistributor.updateLastDistributionTime(),
    "feeKtxDistributor.updateLastDistributionTime"
  );

  const feeKlpTracker = await deployContract("RewardTracker", [
    "Fee KLP",
    "fKLP",
  ]);
  const feeKlpDistributor = await deployContract("RewardDistributor", [
    wbnb.address,
    feeKlpTracker.address,
  ]);
  await sendTxn(
    feeKlpTracker.initialize([klp.address], feeKlpDistributor.address),
    "feeKlpTracker.initialize"
  );
  await sendTxn(
    feeKlpDistributor.updateLastDistributionTime(),
    "feeKlpDistributor.updateLastDistributionTime"
  );

  const stakedKlpTracker = await deployContract("RewardTracker", [
    "Fee + Staked KLP",
    "fsKLP",
  ]);
  const stakedKlpDistributor = await deployContract("RewardDistributor", [
    esKtx.address,
    stakedKlpTracker.address,
  ]);
  await sendTxn(
    stakedKlpTracker.initialize(
      [feeKlpTracker.address],
      stakedKlpDistributor.address
    ),
    "stakedKlpTracker.initialize"
  );
  await sendTxn(
    stakedKlpDistributor.updateLastDistributionTime(),
    "stakedKlpDistributor.updateLastDistributionTime"
  );

  await sendTxn(
    stakedKtxTracker.setInPrivateTransferMode(true),
    "stakedKtxTracker.setInPrivateTransferMode"
  );
  await sendTxn(
    stakedKtxTracker.setInPrivateStakingMode(true),
    "stakedKtxTracker.setInPrivateStakingMode"
  );
  await sendTxn(
    bonusKtxTracker.setInPrivateTransferMode(true),
    "bonusKtxTracker.setInPrivateTransferMode"
  );
  await sendTxn(
    bonusKtxTracker.setInPrivateStakingMode(true),
    "bonusKtxTracker.setInPrivateStakingMode"
  );
  await sendTxn(
    bonusKtxTracker.setInPrivateClaimingMode(true),
    "bonusKtxTracker.setInPrivateClaimingMode"
  );
  await sendTxn(
    feeKtxTracker.setInPrivateTransferMode(true),
    "feeKtxTracker.setInPrivateTransferMode"
  );
  await sendTxn(
    feeKtxTracker.setInPrivateStakingMode(true),
    "feeKtxTracker.setInPrivateStakingMode"
  );

  await sendTxn(
    feeKlpTracker.setInPrivateTransferMode(true),
    "feeKlpTracker.setInPrivateTransferMode"
  );
  await sendTxn(
    feeKlpTracker.setInPrivateStakingMode(true),
    "feeKlpTracker.setInPrivateStakingMode"
  );
  await sendTxn(
    stakedKlpTracker.setInPrivateTransferMode(true),
    "stakedKlpTracker.setInPrivateTransferMode"
  );
  await sendTxn(
    stakedKlpTracker.setInPrivateStakingMode(true),
    "stakedKlpTracker.setInPrivateStakingMode"
  );

  const ktxVester = await deployContract("Vester", [
    "Vested KTX", // _name
    "vKTX", // _symbol
    vestingDuration, // _vestingDuration
    esKtx.address, // _esToken
    feeKtxTracker.address, // _pairToken
    ktx.address, // _claimableToken
    stakedKtxTracker.address, // _rewardTracker
  ]);

  const klpVester = await deployContract("Vester", [
    "Vested KLP", // _name
    "vKLP", // _symbol
    vestingDuration, // _vestingDuration
    esKtx.address, // _esToken
    stakedKlpTracker.address, // _pairToken
    ktx.address, // _claimableToken
    stakedKlpTracker.address, // _rewardTracker
  ]);

  const rewardRouter = await deployContract("RewardRouter", []);
  await sendTxn(
    rewardRouter.initialize(
      wbnb.address,
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
    ),
    "rewardRouter.initialize"
  );

  await sendTxn(
    klpManager.setHandler(rewardRouter.address, true),
    "klpManager.setHandler(rewardRouter)"
  );

  // allow rewardRouter to stake in stakedKtxTracker
  await sendTxn(
    stakedKtxTracker.setHandler(rewardRouter.address, true),
    "stakedKtxTracker.setHandler(rewardRouter)"
  );
  // allow bonusKtxTracker to stake stakedKtxTracker
  await sendTxn(
    stakedKtxTracker.setHandler(bonusKtxTracker.address, true),
    "stakedKtxTracker.setHandler(bonusKtxTracker)"
  );
  // allow rewardRouter to stake in bonusKtxTracker
  await sendTxn(
    bonusKtxTracker.setHandler(rewardRouter.address, true),
    "bonusKtxTracker.setHandler(rewardRouter)"
  );
  // allow bonusKtxTracker to stake feeKtxTracker
  await sendTxn(
    bonusKtxTracker.setHandler(feeKtxTracker.address, true),
    "bonusKtxTracker.setHandler(feeKtxTracker)"
  );
  // bonus multiplier basis: 10000, so 5000 is 50% per year.
  await sendTxn(
    bonusKtxDistributor.setBonusMultiplier(5000),
    "bonusKtxDistributor.setBonusMultiplier"
  );
  // allow rewardRouter to stake in feeKtxTracker
  await sendTxn(
    feeKtxTracker.setHandler(rewardRouter.address, true),
    "feeKtxTracker.setHandler(rewardRouter)"
  );
  // allow stakedKtxTracker to stake esKtx
  await sendTxn(
    esKtx.setHandler(stakedKtxTracker.address, true),
    "esKtx.setHandler(stakedKtxTracker)"
  );
  // allow feeKtxTracker to stake bnKtx
  await sendTxn(
    bnKtx.setHandler(feeKtxTracker.address, true),
    "bnKtx.setHandler(feeKtxTracker"
  );
  // allow rewardRouter to burn bnKtx
  await sendTxn(
    bnKtx.setMinter(rewardRouter.address, true),
    "bnKtx.setMinter(rewardRouter"
  );
  for (let i = 0; i < minter.length; i++) {
    await sendTxn(
      bnKtx.setMinter(minter[i], true),
      `bnKtx.setMinter: ${minter[i]}`
    );
  }

  // allow stakedKlpTracker to stake feeKlpTracker
  await sendTxn(
    feeKlpTracker.setHandler(stakedKlpTracker.address, true),
    "feeKlpTracker.setHandler(stakedKlpTracker)"
  );
  // allow feeKlpTracker to stake klp
  await sendTxn(
    klp.setHandler(feeKlpTracker.address, true),
    "klp.setHandler(feeKlpTracker)"
  );

  // allow rewardRouter to stake in feeKlpTracker
  await sendTxn(
    feeKlpTracker.setHandler(rewardRouter.address, true),
    "feeKlpTracker.setHandler(rewardRouter)"
  );
  // allow rewardRouter to stake in stakedKlpTracker
  await sendTxn(
    stakedKlpTracker.setHandler(rewardRouter.address, true),
    "stakedKlpTracker.setHandler(rewardRouter)"
  );

  await sendTxn(
    esKtx.setHandler(rewardRouter.address, true),
    "esKtx.setHandler(rewardRouter)"
  );
  await sendTxn(
    esKtx.setHandler(stakedKtxDistributor.address, true),
    "esKtx.setHandler(stakedKtxDistributor)"
  );
  await sendTxn(
    esKtx.setHandler(stakedKlpDistributor.address, true),
    "esKtx.setHandler(stakedKlpDistributor)"
  );
  await sendTxn(
    esKtx.setHandler(stakedKlpTracker.address, true),
    "esKtx.setHandler(stakedKlpTracker)"
  );
  await sendTxn(
    esKtx.setHandler(ktxVester.address, true),
    "esKtx.setHandler(ktxVester)"
  );
  await sendTxn(
    esKtx.setHandler(klpVester.address, true),
    "esKtx.setHandler(klpVester)"
  );

  await sendTxn(
    esKtx.setMinter(ktxVester.address, true),
    "esKtx.setMinter(ktxVester)"
  );
  await sendTxn(
    esKtx.setMinter(klpVester.address, true),
    "esKtx.setMinter(klpVester)"
  );
  for (let i = 0; i < minter.length; i++) {
    await sendTxn(
      esKtx.setMinter(minter[i], true),
      `esKtx.setMinter: ${minter[i]}`
    );
  }

  await sendTxn(
    ktxVester.setHandler(rewardRouter.address, true),
    "ktxVester.setHandler(rewardRouter)"
  );
  await sendTxn(
    klpVester.setHandler(rewardRouter.address, true),
    "klpVester.setHandler(rewardRouter)"
  );

  await sendTxn(
    feeKtxTracker.setHandler(ktxVester.address, true),
    "feeKtxTracker.setHandler(ktxVester)"
  );
  await sendTxn(
    stakedKlpTracker.setHandler(klpVester.address, true),
    "stakedKlpTracker.setHandler(klpVester)"
  );

  return [
    stakedKtxTracker,
    stakedKtxDistributor,
    bonusKtxTracker,
    bonusKtxDistributor,
    feeKtxTracker,
    feeKtxDistributor,
    feeKlpTracker,
    feeKlpDistributor,
    stakedKlpTracker,
    stakedKlpDistributor,
    ktxVester,
    klpVester,
    rewardRouter,
  ];
}
async function deployStakeManager() {
  const stakeManager = await deployContract("StakeManager", []);
  return stakeManager;
}

async function main() {
  const provider = ethers.provider;
  const signer = await getFrameSigner();

  let bnb, btc, eth, busd, usdt;
  if (network.name == "localhost") {
    bnb = await deployContract("Token", []);
    await bnb.deployed();

    btc = await deployContract("Token", []);
    await btc.deployed();

    eth = await deployContract("Token", []);
    await eth.deployed();

    busd = await deployContract("Token", []);
    await busd.deployed();

    usdt = await deployContract("Token", []);
    await usdt.deployed();
  } else {
    bnb = await contractAt(
      "Token",
      "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd"
    );
    btc = await contractAt(
      "Token",
      "0x88448E5608F35E1f67Bdb39cbA3445Fc923b09e5"
    );
    eth = await contractAt(
      "Token",
      "0x143DFdedF1062155B9E6ea80D1645D650C509780"
    );
    busd = await contractAt(
      "Token",
      "0x6993eC95A649310C88a946A94c20B2aBd37251eC"
    );
    usdt = await contractAt(
      "Token",
      "0xd4f65b75a2294e4e0cc4e6833092b5a29315c973"
    );
  }

  const bnbPriceFeed = await deployContract("PriceFeed", []);
  await bnbPriceFeed.deployed();
  console.log("bnbPriceFeed address:", bnbPriceFeed.address);

  const btcPriceFeed = await deployContract("PriceFeed", []);
  await btcPriceFeed.deployed();
  console.log("btcPriceFeed address:", btcPriceFeed.address);

  const ethPriceFeed = await deployContract("PriceFeed", []);
  await ethPriceFeed.deployed();
  console.log("ethPriceFeed address:", ethPriceFeed.address);

  const busdPriceFeed = await deployContract("PriceFeed", []);
  await busdPriceFeed.deployed();
  console.log("busdPriceFeed address:", busdPriceFeed.address);

  const usdtPriceFeed = await deployContract("PriceFeed", []);
  await usdtPriceFeed.deployed();
  console.log("usdtPriceFeed address:", usdtPriceFeed.address);

  const tokens = {
    btc: {
      name: "btc",
      address: btc.address,
      priceFeed: btcPriceFeed.address,
      decimals: 8,
      priceDecimals: 8,
      fastPricePrecision: 1000,
      maxCumulativeDeltaDiff: 10 * 1000 * 1000,
      isStrictStable: false,
      tokenWeight: 19000,
      minProfitBps: 0,
      maxUsdgAmount: 200 * 1000 * 1000,
      bufferAmount: 1500,
      isStable: false,
      isShortable: true,
      maxGlobalShortSize: 20 * 1000 * 1000,
    },
    eth: {
      name: "eth",
      address: eth.address,
      priceFeed: ethPriceFeed.address,
      decimals: 18,
      priceDecimals: 8,
      fastPricePrecision: 1000,
      maxCumulativeDeltaDiff: 10 * 1000 * 1000,
      isStrictStable: false,
      tokenWeight: 30000,
      minProfitBps: 0,
      maxUsdgAmount: 400 * 1000 * 1000,
      bufferAmount: 42000,
      isStable: false,
      isShortable: true,
      maxGlobalShortSize: 35 * 1000 * 1000,
    },
    bnb: {
      name: "bnb",
      address: bnb.address,
      priceFeed: bnbPriceFeed.address,
      decimals: 18,
      priceDecimals: 8,
      fastPricePrecision: 1000,
      maxCumulativeDeltaDiff: 10 * 1000 * 1000,
      isStrictStable: false,
      tokenWeight: 1000,
      minProfitBps: 0,
      maxUsdgAmount: 200 * 1000 * 1000,
      bufferAmount: 42000,
      isStable: false,
      isShortable: true,
      maxGlobalShortSize: 35 * 1000 * 1000,
    },
    busd: {
      name: "busd",
      address: busd.address,
      priceFeed: busdPriceFeed.address,
      decimals: 18,
      priceDecimals: 8,
      fastPricePrecision: 1000,
      maxCumulativeDeltaDiff: 10 * 1000 * 1000,
      isStrictStable: true,
      tokenWeight: 25000,
      minProfitBps: 0,
      maxUsdgAmount: 800 * 1000 * 1000,
      bufferAmount: 95 * 1000 * 1000,
      isStable: true,
      isShortable: false,
    },
    usdt: {
      name: "usdt",
      address: usdt.address,
      priceFeed: usdtPriceFeed.address,
      decimals: 18,
      priceDecimals: 8,
      fastPricePrecision: 1000,
      maxCumulativeDeltaDiff: 10 * 1000 * 1000,
      isStrictStable: true,
      tokenWeight: 25000,
      minProfitBps: 0,
      maxUsdgAmount: 800 * 1000 * 1000,
      bufferAmount: 95 * 1000 * 1000,
      isStable: true,
      isShortable: false,
    },
    wbnb: {
      name: "bnb",
      address: bnb.address,
      priceFeed: bnbPriceFeed.address,
      decimals: 18,
      priceDecimals: 8,
      isStrictStable: false,
      fastPricePrecision: 1000,
      maxCumulativeDeltaDiff: 10 * 1000 * 1000,
    },
  };
  const [ktx, esKtx, bnKtx] = await deployKtx();

  const [
    vault,
    usdg,
    router,
    vaultPriceFeed,
    klp,
    klpManager,
    vaultUtils,
    shortsTracker,
  ] = await deployVault(tokens);

  const tokenManager = await deployTokenManager();
  console.log("TokenManager address:", tokenManager.address);

  // const klpManager = await deployKlpManager(vault, usdg, klp);
  // console.log("KlpManager address:", klpManager.address);

  const orderBook = await deployOrderBook(tokens, router, vault, usdg);
  console.log("OrderBook address:", orderBook.address);

  // const orderExecutor = await deployOrderExecutor(vault, orderBook);
  // console.log("OrderExecutor address:", orderExecutor.address);

  const [referralStorage, positionRouter] = await deployPositionRouter(
    vault,
    router,
    tokens.wbnb
  );
  console.log("PositionRouter address:", positionRouter.address);

  const positionManager = await deployPositionManager(
    vault,
    router,
    tokens.wbnb,
    orderBook
  );
  console.log("PositionManager address:", positionManager.address);

  const [
    stakedKtxTracker,
    stakedKtxDistributor,
    bonusKtxTracker,
    bonusKtxDistributor,
    feeKtxTracker,
    feeKtxDistributor,
    feeKlpTracker,
    feeKlpDistributor,
    stakedKlpTracker,
    stakedKlpDistributor,
    ktxVester,
    klpVester,
    rewardRouter,
  ] = await deployRewardRouter(tokens, klpManager, klp, ktx, esKtx, bnKtx);
  const rewardManager = await deployContract(
    "RewardManager",
    [],
    "RewardManager"
  );

  const timelock = await deployTimeLock(
    tokenManager,
    klpManager,
    rewardRouter,
    positionRouter,
    positionManager,
    rewardManager
  );

  // const vaultUnils = await deployVaultUtiles(vault, timelock);
  // console.log("VaultUnils address:", vaultUnils.address);

  await sendTxn(esKtx.setGov(timelock.address), "set gov");
  await sendTxn(bnKtx.setGov(timelock.address), "set gov");
  await sendTxn(ktxVester.setGov(timelock.address), "set gov");
  await sendTxn(klpVester.setGov(timelock.address), "set gov");
  await sendTxn(shortsTracker.setGov(timelock.address), "set gov");
  await sendTxn(klpManager.setGov(timelock.address), "set gov");
  await sendTxn(stakedKtxTracker.setGov(timelock.address), "set gov");
  await sendTxn(bonusKtxTracker.setGov(timelock.address), "set gov");
  await sendTxn(feeKtxTracker.setGov(timelock.address), "set gov");
  await sendTxn(feeKlpTracker.setGov(timelock.address), "set gov");
  await sendTxn(stakedKlpTracker.setGov(timelock.address), "set gov");
  await sendTxn(stakedKtxDistributor.setGov(timelock.address), "set gov");
  await sendTxn(stakedKlpDistributor.setGov(timelock.address), "set gov");

  await sendTxn(
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
    ),
    "rewardManager.initialize"
  );

  await sendTxn(
    rewardManager.updateEsKtxHandlers(),
    "rewardManager.updateEsKtxHandlers"
  );
  await sendTxn(
    rewardManager.enableRewardRouter(),
    "rewardManager.enableRewardRouter"
  );

  // const priceFeedTimelock = await deployPriceFeedTimelock(
  //   router,
  //   vaultPriceFeed,
  //   tokenManager
  // );

  const [fastPriceEvents, secondaryPriceFeed] = await deployPriceFeed(
    vault,
    tokens,
    timelock,
    tokenManager,
    positionRouter,
    vaultPriceFeed,
    positionManager
  );

  await setVaultTokenConfig(
    vault,
    vaultPriceFeed,
    tokens,
    ethPriceFeed,
    btcPriceFeed,
    bnbPriceFeed,
    busdPriceFeed,
    usdtPriceFeed
  );

  await sendTxn(
    vault.setGov(timelock.address),
    "vault.setGov(timelock.address)"
  );
  await sendTxn(
    vaultPriceFeed.setGov(timelock.address),
    "vaultPriceFeed.setGov"
  );

  const balanceUpdater = await deployBalanceUpdater();
  const batchSender = await deployBatchSender();
  const esKtxBatchSender = await deployEsKtxBatchSender(esKtx);
  const ktxTimelock = await deployKtxTimelock(tokenManager, rewardManager);
  const orderBookReader = await deployOrderBookReader();
  const reader = await deployReader();
  const rewardReader = await deployRewardReader();
  const vaultReader = await deployVaultReader();
  const [stakedKlp, klpBalance] = await deployStakedKlp(
    klp,
    klpManager,
    stakedKlpTracker,
    feeKlpTracker
  );
  const stakeManager = await deployStakeManager();
  // const bridge = await deployBridge(ktx, wKtx);
  // const snapshotToken = await deploySnapshotToken();

  // const addresses = await deployFaucetToken();
  await router.addPlugin(orderBook.address);
  await router.approvePlugin(orderBook.address);
  await router.approvePlugin(positionRouter.address);
  await router.approvePlugin(positionManager.address);
  await positionRouter.setPositionKeeper(signer.address, true);

  const minExecutionFee = "0.0016";
  await positionRouter.setMinExecutionFee(
    ethers.utils.parseEther(minExecutionFee)
  );
  await orderBook.setMinExecutionFee(ethers.utils.parseEther(minExecutionFee));
  await orderBook.setMinPurchaseTokenAmountUsd(100);

  await sendTxn(
    referralStorage.setTier(0, 1000, 5000),
    "referralStorage.setTier 0"
  );
  await sendTxn(
    referralStorage.setTier(1, 2000, 5000),
    "referralStorage.setTier 1"
  );
  await sendTxn(
    referralStorage.setTier(2, 2500, 4000),
    "referralStorage.setTier 2"
  );

  console.log('NATIVE_TOKEN: "%s",', tokens.wbnb.address);
  console.log('btc: "%s",', btc.address);
  console.log('btcPriceFeed: "%s",', btcPriceFeed.address);
  console.log('eth: "%s",', eth.address);
  console.log('ethPriceFeed: "%s",', ethPriceFeed.address);
  console.log('bnb: "%s",', bnb.address);
  console.log('bnbPriceFeed: "%s",', bnbPriceFeed.address);
  console.log('busd: "%s",', busd.address);
  console.log('busdPriceFeed: "%s",', busdPriceFeed.address);
  console.log('usdt: "%s",', usdt.address);
  console.log('usdtPriceFeed: "%s",', usdtPriceFeed.address);
  console.log('VaultReader: "%s",', vaultReader.address);
  console.log('Reader: "%s",', reader.address);
  console.log('OrderBook: "%s",', orderBook.address);
  console.log('OrderBookReader: "%s",', orderBookReader.address);
  console.log('Router: "%s",', router.address);
  console.log('USDG: "%s",', usdg.address);
  console.log('Vault: "%s",', vault.address);
  console.log('PositionRouter: "%s",', positionRouter.address);
  console.log('PositionManager: "%s",', positionManager.address);
  console.log('KlpManager: "%s",', klpManager.address);
  console.log('KTX: "%s",', ktx.address);
  console.log('ES_KTX: "%s",', esKtx.address);
  console.log('BN_KTX: "%s",', bnKtx.address);
  console.log('KLP: "%s",', klp.address);
  console.log('RewardRouter: "%s",', rewardRouter.address);
  console.log('RewardReader: "%s",', rewardReader.address);
  console.log('StakedKtxTracker: "%s",', stakedKtxTracker.address);
  console.log('BonusKtxTracker: "%s",', bonusKtxTracker.address);
  console.log('FeeKtxTracker: "%s",', feeKtxTracker.address);
  console.log('StakedKlpTracker: "%s",', stakedKlpTracker.address);
  console.log('FeeKlpTracker: "%s",', feeKlpTracker.address);
  console.log('StakedKtxDistributor: "%s",', stakedKtxDistributor.address);
  console.log('StakedKlpDistributor: "%s",', stakedKlpDistributor.address);
  console.log('FeeKlpDistributor: "%s",', feeKlpDistributor.address);
  console.log('FeeKtxDistributor: "%s",', feeKtxDistributor.address);
  console.log('KtxVester: "%s",', ktxVester.address);
  console.log('KlpVester: "%s",', klpVester.address);
  console.log('ReferralStorage: "%s",', referralStorage.address);
  console.log('VaultPriceFeed: "%s",', vaultPriceFeed.address);
  console.log('KtxTimelock: "%s",', ktxTimelock.address);
  console.log('Timelock: "%s",', timelock.address);
  console.log('FeeKtxRewardDistributor: "%s",', feeKtxDistributor.address);
  console.log('EsktxKtxRewardDistributor: "%s",', stakedKtxDistributor.address);
  console.log('FeeKlpRewardDistributor: "%s",', feeKlpDistributor.address);
  console.log('EsktxKlpRewardDistributor: "%s",', stakedKlpDistributor.address);
  console.log('SecondaryPriceFeed: "%s",', secondaryPriceFeed.address);
  console.log('BonusKtxDistributor: "%s",', bonusKtxDistributor.address);
  console.log('BatchSender: "%s",', batchSender.address);
  console.log('ShortsTracker: "%s",', shortsTracker.address);
  console.log('RewardManager: "%s",', rewardManager.address);
  console.log('FastPriceEvents: "%s"', fastPriceEvents.address);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
