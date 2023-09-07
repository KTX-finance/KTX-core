const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployContract } = require("../shared/fixtures");

describe("BridgeLocker", function () {
  let testToken;
  let bridgeLocker;
  let owner;
  let addr1;
  let addr2;
  let addrs;

  beforeEach(async function () {
    [owner, addr1, addr2, ...addrs] = await ethers.getSigners();
    testToken = await deployContract("Token", []);
    await testToken.mint(owner.address, ethers.utils.parseEther("10"));
    bridgeLocker = await deployContract("BridgeLocker", [testToken.address]);
    await testToken.approve(
      bridgeLocker.address,
      ethers.utils.parseEther("10")
    );
  });

  describe("Register Chain Token", function () {
    it("Should register and update", async function () {
      await expect(
        bridgeLocker.registerChainToken(2, bridgeLocker.address)
      ).to.be.revertedWith("BridgeLocker: forbidden");

      await expect(
        bridgeLocker.connect(addr1).setHandler(bridgeLocker.address, true)
      ).to.be.revertedWith("Governable: forbidden");

      await bridgeLocker.setHandler(owner.address, true);

      await bridgeLocker.registerChainToken(1, bridgeLocker.address);
      expect(await bridgeLocker.chainTokenAddr(1)).to.equal(
        bridgeLocker.address
      );

      await bridgeLocker.registerChainToken(1, owner.address);
      expect(await bridgeLocker.chainTokenAddr(1)).to.equal(owner.address);
    });
  });

  describe("Lock", function () {
    it("Should lock and unlock", async function () {
      await expect(
        bridgeLocker.lock(ethers.utils.parseEther("1"), 1)
      ).to.be.revertedWith("BridgeLocker: forbidden");

      await bridgeLocker.setHandler(owner.address, true);

      await bridgeLocker.lock(ethers.utils.parseEther("1"), 1);
      expect(await testToken.balanceOf(bridgeLocker.address)).to.equal(
        ethers.utils.parseEther("1")
      );
      expect(await bridgeLocker.chainLock(1)).to.equal(
        ethers.utils.parseEther("1")
      );

      await bridgeLocker.lock(ethers.utils.parseEther("2"), 2);
      expect(await testToken.balanceOf(bridgeLocker.address)).to.equal(
        ethers.utils.parseEther("3")
      );
      expect(await bridgeLocker.chainLock(2)).to.equal(
        ethers.utils.parseEther("2")
      );

      await expect(
        bridgeLocker.unlock(ethers.utils.parseEther("2"), 1, owner.address)
      ).to.be.revertedWith("No enough token locked to chain");

      await expect(
        bridgeLocker.unlock(ethers.utils.parseEther("4"), 1, owner.address)
      ).to.be.revertedWith("No enough token locked");

      await bridgeLocker.unlock(ethers.utils.parseEther("2"), 2, owner.address);
      expect(await testToken.balanceOf(bridgeLocker.address)).to.equal(
        ethers.utils.parseEther("1")
      );
      expect(await testToken.balanceOf(owner.address)).to.equal(
        ethers.utils.parseEther("9")
      );
      await expect(
        bridgeLocker.unlock(ethers.utils.parseEther("1"), 2, owner.address)
      ).to.be.revertedWith("No enough token locked to chain");
    });
  });
});
