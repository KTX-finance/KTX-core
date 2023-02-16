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
} = require("../shared/utilities");
const { toChainlinkPrice } = require("../shared/chainlink");
const { toUsd, toNormalizedPrice } = require("../shared/units");

use(solidity);

describe("BonusDistributor", function () {
  const provider = waffle.provider;
  const [wallet, rewardRouter, user0, user1, user2, user3] =
    provider.getWallets();
  let ktx;
  let esKtx;
  let bnKtx;
  let stakedKtxTracker;
  let stakedKtxDistributor;
  let bonusKtxTracker;
  let bonusKtxDistributor;

  beforeEach(async () => {
    ktx = await deployContract("KTX", []);
    esKtx = await deployContract("EsKTX", []);
    bnKtx = await deployContract("MintableBaseToken", [
      "Bonus KTX",
      "bnKTX",
      0,
    ]);

    stakedKtxTracker = await deployContract("RewardTracker", [
      "Staked KTX",
      "stKTX",
    ]);
    stakedKtxDistributor = await deployContract("RewardDistributor", [
      esKtx.address,
      stakedKtxTracker.address,
    ]);
    await stakedKtxDistributor.updateLastDistributionTime();

    bonusKtxTracker = await deployContract("RewardTracker", [
      "Staked + Bonus KTX",
      "sbKTX",
    ]);
    bonusKtxDistributor = await deployContract("BonusDistributor", [
      bnKtx.address,
      bonusKtxTracker.address,
    ]);
    await bonusKtxDistributor.updateLastDistributionTime();

    await stakedKtxTracker.initialize(
      [ktx.address, esKtx.address],
      stakedKtxDistributor.address
    );
    await bonusKtxTracker.initialize(
      [stakedKtxTracker.address],
      bonusKtxDistributor.address
    );

    await stakedKtxTracker.setInPrivateTransferMode(true);
    await stakedKtxTracker.setInPrivateStakingMode(true);
    await bonusKtxTracker.setInPrivateTransferMode(true);
    await bonusKtxTracker.setInPrivateStakingMode(true);

    await stakedKtxTracker.setHandler(rewardRouter.address, true);
    await stakedKtxTracker.setHandler(bonusKtxTracker.address, true);
    await bonusKtxTracker.setHandler(rewardRouter.address, true);
    await bonusKtxDistributor.setBonusMultiplier(10000);
  });

  it("distributes bonus", async () => {
    await esKtx.setMinter(wallet.address, true);
    await esKtx.mint(stakedKtxDistributor.address, expandDecimals(50000, 18));
    await bnKtx.setMinter(wallet.address, true);
    await bnKtx.mint(bonusKtxDistributor.address, expandDecimals(1500, 18));
    await stakedKtxDistributor.setTokensPerInterval("20667989410000000"); // 0.02066798941 esKtx per second
    await ktx.setMinter(wallet.address, true);
    await ktx.mint(user0.address, expandDecimals(1000, 18));

    await ktx
      .connect(user0)
      .approve(stakedKtxTracker.address, expandDecimals(1001, 18));
    await expect(
      stakedKtxTracker
        .connect(rewardRouter)
        .stakeForAccount(
          user0.address,
          user0.address,
          ktx.address,
          expandDecimals(1001, 18)
        )
    ).to.be.revertedWith("BaseToken: transfer amount exceeds balance");
    await stakedKtxTracker
      .connect(rewardRouter)
      .stakeForAccount(
        user0.address,
        user0.address,
        ktx.address,
        expandDecimals(1000, 18)
      );
    await expect(
      bonusKtxTracker
        .connect(rewardRouter)
        .stakeForAccount(
          user0.address,
          user0.address,
          stakedKtxTracker.address,
          expandDecimals(1001, 18)
        )
    ).to.be.revertedWith("RewardTracker: transfer amount exceeds balance");
    await bonusKtxTracker
      .connect(rewardRouter)
      .stakeForAccount(
        user0.address,
        user0.address,
        stakedKtxTracker.address,
        expandDecimals(1000, 18)
      );

    await increaseTime(provider, 24 * 60 * 60);
    await mineBlock(provider);

    expect(await stakedKtxTracker.claimable(user0.address)).gt(
      expandDecimals(1785, 18)
    ); // 50000 / 28 => ~1785
    expect(await stakedKtxTracker.claimable(user0.address)).lt(
      expandDecimals(1786, 18)
    );
    expect(await bonusKtxTracker.claimable(user0.address)).gt(
      "2730000000000000000"
    ); // 2.73, 1000 / 365 => ~2.74
    expect(await bonusKtxTracker.claimable(user0.address)).lt(
      "2750000000000000000"
    ); // 2.75

    await esKtx.mint(user1.address, expandDecimals(500, 18));
    await esKtx
      .connect(user1)
      .approve(stakedKtxTracker.address, expandDecimals(500, 18));
    await stakedKtxTracker
      .connect(rewardRouter)
      .stakeForAccount(
        user1.address,
        user1.address,
        esKtx.address,
        expandDecimals(500, 18)
      );
    await bonusKtxTracker
      .connect(rewardRouter)
      .stakeForAccount(
        user1.address,
        user1.address,
        stakedKtxTracker.address,
        expandDecimals(500, 18)
      );

    await increaseTime(provider, 24 * 60 * 60);
    await mineBlock(provider);

    expect(await stakedKtxTracker.claimable(user0.address)).gt(
      expandDecimals(1785 + 1190, 18)
    );
    expect(await stakedKtxTracker.claimable(user0.address)).lt(
      expandDecimals(1786 + 1191, 18)
    );

    expect(await stakedKtxTracker.claimable(user1.address)).gt(
      expandDecimals(595, 18)
    );
    expect(await stakedKtxTracker.claimable(user1.address)).lt(
      expandDecimals(596, 18)
    );

    expect(await bonusKtxTracker.claimable(user0.address)).gt(
      "5470000000000000000"
    ); // 5.47, 1000 / 365 * 2 => ~5.48
    expect(await bonusKtxTracker.claimable(user0.address)).lt(
      "5490000000000000000"
    ); // 5.49

    expect(await bonusKtxTracker.claimable(user1.address)).gt(
      "1360000000000000000"
    ); // 1.36, 500 / 365 => ~1.37
    expect(await bonusKtxTracker.claimable(user1.address)).lt(
      "1380000000000000000"
    ); // 1.38
  });
});
