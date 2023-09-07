const { expect, use } = require("chai");
const { solidity } = require("ethereum-waffle");
const { deployContract } = require("../shared/fixtures");
const {
  expandDecimals,
  getBlockTime,
  increaseTime,
  mineBlock,
  reportGasUsed,
} = require("../shared/utilities");
const { toChainlinkPrice } = require("../shared/chainlink");
const { toUsd, toNormalizedPrice } = require("../shared/units");

use(solidity);

describe("RewardClaimer", function () {
  const provider = waffle.provider;
  const [wallet, user0, user1, user2, user3] = provider.getWallets();
  let rewardClaimer;
  let ktx;
  let esKtx;
  let rewardDistributor;

  beforeEach(async () => {
    ktx = await deployContract("KTX", []);
    esKtx = await deployContract("EsKTX", []);
    rewardClaimer = await deployContract("RewardClaimer", [
      [ktx.address, esKtx.address],
    ]);
  });

  it("inits", async () => {
    expect(await rewardClaimer.isClaimableToken(wallet.address)).eq(false);
    expect(await rewardClaimer.isClaimableToken(ktx.address)).eq(true);
    expect(await rewardClaimer.isClaimableToken(esKtx.address)).eq(true);
  });

  it("setClaimableToken", async () => {
    await expect(
      rewardClaimer.connect(user0).setClaimableToken(user1.address, true)
    ).to.be.revertedWith("Governable: forbidden");

    await rewardClaimer.setGov(user0.address);

    expect(await rewardClaimer.isClaimableToken(user1.address)).eq(false);
    await rewardClaimer.connect(user0).setClaimableToken(user1.address, true);
    expect(await rewardClaimer.isClaimableToken(user1.address)).eq(true);
    await rewardClaimer.connect(user0).setClaimableToken(user1.address, false);
    expect(await rewardClaimer.isClaimableToken(user1.address)).eq(false);
  });

  it("setHandler", async () => {
    await expect(
      rewardClaimer.connect(user0).setHandler(user1.address, true)
    ).to.be.revertedWith("Governable: forbidden");

    await rewardClaimer.setGov(user0.address);

    expect(await rewardClaimer.isHandler(user1.address)).eq(false);
    await rewardClaimer.connect(user0).setHandler(user1.address, true);
    expect(await rewardClaimer.isHandler(user1.address)).eq(true);
  });

  it("withdrawToken", async () => {
    await ktx.setMinter(wallet.address, true);
    await ktx.mint(rewardClaimer.address, 2000);
    await expect(
      rewardClaimer
        .connect(user0)
        .withdrawToken(ktx.address, user1.address, 2000)
    ).to.be.revertedWith("Governable: forbidden");

    await rewardClaimer.setGov(user0.address);

    expect(await ktx.balanceOf(user1.address)).eq(0);
    await rewardClaimer
      .connect(user0)
      .withdrawToken(ktx.address, user1.address, 2000);
    expect(await ktx.balanceOf(user1.address)).eq(2000);
  });

  it("increase, decrease, claim", async () => {
    await expect(
      rewardClaimer.increaseClaimableAmounts(esKtx.address, [user1.address], [])
    ).to.be.revertedWith("RewardClaimer: invalid param");

    await expect(
      rewardClaimer.increaseClaimableAmounts(
        esKtx.address,
        [user1.address],
        [expandDecimals(1, 18)]
      )
    ).to.be.revertedWith("RewardClaimer: forbidden");

    await rewardClaimer.setHandler(wallet.address, true);

    await esKtx.setMinter(wallet.address, true);
    await esKtx.mint(rewardClaimer.address, expandDecimals(1000, 18));

    await ktx.setMinter(wallet.address, true);
    await ktx.mint(rewardClaimer.address, expandDecimals(1000, 18));

    await rewardClaimer.increaseClaimableAmounts(
      esKtx.address,
      [user1.address, user2.address],
      [expandDecimals(1, 18), expandDecimals(2, 18)]
    );

    expect(
      await rewardClaimer.claimableAmount(user1.address, esKtx.address)
    ).eq(expandDecimals(1, 18));

    expect(
      await rewardClaimer.claimableAmount(user2.address, esKtx.address)
    ).eq(expandDecimals(2, 18));

    expect(await rewardClaimer.getWithdrawableAmount(esKtx.address)).eq(
      expandDecimals(997, 18)
    );

    await rewardClaimer.decreaseClaimableAmounts(
      esKtx.address,
      [user1.address, user2.address],
      [expandDecimals(1, 18), expandDecimals(1, 18)]
    );

    expect(
      await rewardClaimer.claimableAmount(user1.address, esKtx.address)
    ).eq(0);

    expect(
      await rewardClaimer.claimableAmount(user2.address, esKtx.address)
    ).eq(expandDecimals(1, 18));

    expect(await rewardClaimer.getWithdrawableAmount(esKtx.address)).eq(
      expandDecimals(999, 18)
    );

    await rewardClaimer.connect(user2).claim(user2.address, [esKtx.address]);
    expect(await esKtx.balanceOf(user2.address)).eq(expandDecimals(1, 18));

    expect(
      await rewardClaimer.claimableAmount(user2.address, esKtx.address)
    ).eq(0);

    expect(await rewardClaimer.getWithdrawableAmount(esKtx.address)).eq(
      expandDecimals(999, 18)
    );
  });

  it("increase, claimForAccount", async () => {
    await rewardClaimer.setHandler(wallet.address, true);

    await ktx.setMinter(wallet.address, true);
    await ktx.mint(rewardClaimer.address, expandDecimals(1000, 18));

    await rewardClaimer.increaseClaimableAmounts(
      ktx.address,
      [user1.address, user2.address],
      [expandDecimals(1, 18), expandDecimals(2, 18)]
    );

    expect(await rewardClaimer.claimableAmount(user1.address, ktx.address)).eq(
      expandDecimals(1, 18)
    );

    expect(await rewardClaimer.getWithdrawableAmount(ktx.address)).eq(
      expandDecimals(997, 18)
    );

    await rewardClaimer.claimForAccount(user1.address, user2.address, [
      ktx.address,
    ]);

    expect(await rewardClaimer.claimableAmount(user2.address, ktx.address)).eq(
      expandDecimals(2, 18)
    );
    expect(await rewardClaimer.claimableAmount(user1.address, ktx.address)).eq(
      0
    );

    expect(await ktx.balanceOf(user2.address)).eq(expandDecimals(1, 18));
    expect(await ktx.balanceOf(user1.address)).eq(0);
  });
});
