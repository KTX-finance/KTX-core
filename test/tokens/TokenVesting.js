const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployContract } = require("../shared/fixtures");

describe("TokenVesting", function () {
  let TokenContract;
  let testToken;
  let TokenVestingContract;
  let owner;
  let addr1;
  let addr2;
  let addrs;
  const teamPoolAmount = ethers.utils.parseEther("20000000");
  const investorPoolAmount = ethers.utils.parseEther("25000000");
  const launchTime = 1661990400; // (Thu Sep 01 2022 00:00:00 GMT+0000)
  const timeDuration6Month = 15780000;

  beforeEach(async function () {
    [owner, addr1, addr2, ...addrs] = await ethers.getSigners();
    testToken = await deployContract("Token", []);
    await testToken.mint(owner.address, ethers.utils.parseEther("1000000000"));
  });

  describe("Vesting", function () {
    it("Should assign the total supply of tokens to the owner", async function () {
      const ownerBalance = await testToken.balanceOf(owner.address);
      expect(await testToken.totalSupply()).to.equal(ownerBalance);
    });

    it("Should vest tokens gradually", async function () {
      // deploy vesting contract
      const tokenVesting = await deployContract("MockTokenVesting", [
        testToken.address,
        launchTime,
      ]);
      await tokenVesting.deployed();
      await tokenVesting.setCurrentTime(0);
      expect((await tokenVesting.getToken()).toString()).to.equal(
        testToken.address
      );
      // send tokens to vesting contract
      await expect(testToken.transfer(tokenVesting.address, teamPoolAmount))
        .to.emit(testToken, "Transfer")
        .withArgs(owner.address, tokenVesting.address, teamPoolAmount);

      const vestingContractBalance = await testToken.balanceOf(
        tokenVesting.address
      );
      expect(vestingContractBalance).to.equal(teamPoolAmount);
      expect(await tokenVesting.getWithdrawableAmount()).to.equal(
        teamPoolAmount
      );

      const beneficiary = addr1;
      const startTimeAfterLaunch = timeDuration6Month;
      const cliff = 0;
      const duration = 1000;
      const slicePeriodSeconds = 1;
      const revokable = true;
      const amount = 100;

      // create new vesting schedule
      await tokenVesting.createVestingSchedule(
        beneficiary.address,
        startTimeAfterLaunch,
        cliff,
        duration,
        slicePeriodSeconds,
        revokable,
        amount
      );
      expect(await tokenVesting.getVestingSchedulesCount()).to.be.equal(1);
      expect(
        await tokenVesting.getVestingSchedulesCountByBeneficiary(
          beneficiary.address
        )
      ).to.be.equal(1);

      // check total amount
      expect(await tokenVesting.getVestingSchedulesTotalAmount()).to.be.equal(
        100
      );
      expect(await tokenVesting.getWithdrawableAmount()).to.equal(
        teamPoolAmount.sub(100)
      );

      // compute vesting schedule id
      const vestingScheduleId =
        await tokenVesting.computeVestingScheduleIdForAddressAndIndex(
          beneficiary.address,
          0
        );

      // check that releasable amount is 0
      expect(
        await tokenVesting.computeReleasableAmount(vestingScheduleId)
      ).to.be.equal(0);

      // check getVestingIdAtIndex gives correct vesting id
      expect(await tokenVesting.getVestingIdAtIndex(0)).to.be.equal(
        vestingScheduleId
      );

      // set time to start time
      const starTime = launchTime + startTimeAfterLaunch;
      await tokenVesting.setCurrentTime(starTime);

      // check that releasable amount is 0
      expect(
        await tokenVesting.computeReleasableAmount(vestingScheduleId)
      ).to.be.equal(0);

      // set time to half the vesting period
      const halfTime = launchTime + startTimeAfterLaunch + duration / 2;
      await tokenVesting.setCurrentTime(halfTime);

      // check that releasable amount is half the total amount to vest
      expect(
        await tokenVesting
          .connect(beneficiary)
          .computeReleasableAmount(vestingScheduleId)
      ).to.be.equal(50);

      // check that only beneficiary can try to release vested tokens
      await expect(
        tokenVesting.connect(addr2).release(vestingScheduleId, 100)
      ).to.be.revertedWith("tv: not beneficiary or owner");

      // check that beneficiary cannot release more than the releasable amount
      await expect(
        tokenVesting.connect(beneficiary).release(vestingScheduleId, 100)
      ).to.be.revertedWith("tv: no enough vested");

      // release 10 tokens and check that a Transfer event is emitted with a value of 10
      await expect(
        tokenVesting.connect(beneficiary).release(vestingScheduleId, 10)
      )
        .to.emit(testToken, "Transfer")
        .withArgs(tokenVesting.address, beneficiary.address, 10);

      // check that the releasable amount is now 40
      expect(
        await tokenVesting
          .connect(beneficiary)
          .computeReleasableAmount(vestingScheduleId)
      ).to.be.equal(40);
      let vestingSchedule = await tokenVesting.getVestingSchedule(
        vestingScheduleId
      );

      // check getVestingScheduleByAddressAndIndex gives correct vesting id
      expect(
        JSON.stringify(
          await tokenVesting.getVestingScheduleByAddressAndIndex(
            beneficiary.address,
            0
          )
        )
      ).to.be.equal(JSON.stringify(vestingSchedule));

      // check that the released amount is 10
      expect(vestingSchedule.released).to.be.equal(10);

      // set current time after the end of the vesting period
      await tokenVesting.setCurrentTime(
        launchTime + startTimeAfterLaunch + duration + 1
      );

      // check that the releasable amount is 90
      expect(
        await tokenVesting
          .connect(beneficiary)
          .computeReleasableAmount(vestingScheduleId)
      ).to.be.equal(90);

      // beneficiary release vested tokens (45)
      await expect(
        tokenVesting.connect(beneficiary).release(vestingScheduleId, 45)
      )
        .to.emit(testToken, "Transfer")
        .withArgs(tokenVesting.address, beneficiary.address, 45);

      // owner release vested tokens (45)
      await expect(tokenVesting.connect(owner).release(vestingScheduleId, 45))
        .to.emit(testToken, "Transfer")
        .withArgs(tokenVesting.address, beneficiary.address, 45);
      vestingSchedule = await tokenVesting.getVestingSchedule(
        vestingScheduleId
      );

      // check that the number of released tokens is 100
      expect(vestingSchedule.released).to.be.equal(100);

      // check that the releasable amount is 0
      expect(
        await tokenVesting
          .connect(beneficiary)
          .computeReleasableAmount(vestingScheduleId)
      ).to.be.equal(0);

      // check that anyone cannot revoke a vesting
      await expect(
        tokenVesting.connect(addr2).revoke(vestingScheduleId)
      ).to.be.revertedWith("Governable: forbidden");
      await tokenVesting.revoke(vestingScheduleId);

      /*
       * TEST SUMMARY
       * deploy vesting contract
       * send tokens to vesting contract
       * create new vesting schedule (100 tokens)
       * check that releasable amount is 0
       * set time to start time after launch
       * check that releasable amount is 0
       * set time to half the vesting period
       * check that releasable amount is half the total amount to vest (50 tokens)
       * check that only beneficiary can try to release vested tokens
       * check that beneficiary cannot release more than the releasable amount
       * release 10 tokens and check that a Transfer event is emitted with a value of 10
       * check that the released amount is 10
       * check that the releasable amount is now 40
       * set current time after the end of the vesting period
       * check that the releasable amount is 90 (100 - 10 released tokens)
       * release all vested tokens (90)
       * check that the number of released tokens is 100
       * check that the releasable amount is 0
       * check that anyone cannot revoke a vesting
       */
    });

    it("Should vest according to changed launch time", async function () {
      // deploy vesting contract
      const tokenVesting = await deployContract("MockTokenVesting", [
        testToken.address,
        launchTime,
      ]);
      await tokenVesting.setCurrentTime(0);
      expect((await tokenVesting.getToken()).toString()).to.equal(
        testToken.address
      );
      // send tokens to vesting contract
      await expect(testToken.transfer(tokenVesting.address, teamPoolAmount))
        .to.emit(testToken, "Transfer")
        .withArgs(owner.address, tokenVesting.address, teamPoolAmount);
      const vestingContractBalance = await testToken.balanceOf(
        tokenVesting.address
      );
      expect(vestingContractBalance).to.equal(teamPoolAmount);
      expect(await tokenVesting.getWithdrawableAmount()).to.equal(
        teamPoolAmount
      );

      const beneficiary = addr1;
      const startTimeAfterLaunch = timeDuration6Month;
      const cliff = 0;
      const duration = 1000;
      const slicePeriodSeconds = 1;
      const revokable = false;
      const amount = 100;

      // create new vesting schedule
      await tokenVesting.createVestingSchedule(
        beneficiary.address,
        startTimeAfterLaunch,
        cliff,
        duration,
        slicePeriodSeconds,
        revokable,
        amount
      );

      // compute vesting schedule id
      const vestingScheduleId =
        await tokenVesting.computeVestingScheduleIdForAddressAndIndex(
          beneficiary.address,
          0
        );

      // check that releasable amount is 0
      expect(
        await tokenVesting.computeReleasableAmount(vestingScheduleId)
      ).to.be.equal(0);

      // set time to launch time
      await tokenVesting.setCurrentTime(launchTime);

      // check that releasable amount is 0
      expect(
        await tokenVesting.computeReleasableAmount(vestingScheduleId)
      ).to.be.equal(0);

      // check that anyone cannot change launch time
      await expect(
        tokenVesting.connect(addr2).setLaunchTime(launchTime)
      ).to.be.revertedWith("Governable: forbidden");

      // change launch time to half duration before start time
      const newLaunchTime = launchTime - startTimeAfterLaunch - duration / 2;
      await tokenVesting.setLaunchTime(newLaunchTime);

      // check that releasable amount is half the total amount to vest
      expect(
        await tokenVesting
          .connect(beneficiary)
          .computeReleasableAmount(vestingScheduleId)
      ).to.be.equal(50);

      // release 10 tokens and check that a Transfer event is emitted with a value of 10
      await expect(
        tokenVesting.connect(beneficiary).release(vestingScheduleId, 10)
      )
        .to.emit(testToken, "Transfer")
        .withArgs(tokenVesting.address, beneficiary.address, 10);

      // check that the released amount is 10
      let vestingSchedule = await tokenVesting.getVestingSchedule(
        vestingScheduleId
      );
      expect(vestingSchedule.released).to.be.equal(10);

      // set launch time back to initial launch time
      await tokenVesting.setLaunchTime(launchTime);

      // check that the releasable amount is 0
      expect(
        await tokenVesting
          .connect(beneficiary)
          .computeReleasableAmount(vestingScheduleId)
      ).to.be.equal(0);

      /*
       * TEST SUMMARY
       * deploy vesting contract
       * send tokens to vesting contract
       * create new vesting schedule (100 tokens)
       * check that releasable amount is 0
       * set time to launch time (Thu Sep 01 2022 00:00:00 GMT+0000)
       * check that releasable amount is 0
       * set new launch time as half duration before start time
       * check that releasable amount is half the total amount to vest (50 tokens)
       * release 10 tokens
       * set launch time back to old launch time
       * check that released amount is 10
       * check that releasable amount is 0
       */
    });

    it("Should release vested tokens if revoked", async function () {
      // deploy vesting contract
      const tokenVesting = await deployContract("MockTokenVesting", [
        testToken.address,
        launchTime,
      ]);
      await tokenVesting.setCurrentTime(0);
      expect((await tokenVesting.getToken()).toString()).to.equal(
        testToken.address
      );
      // send tokens to vesting contract
      await expect(testToken.transfer(tokenVesting.address, 1000))
        .to.emit(testToken, "Transfer")
        .withArgs(owner.address, tokenVesting.address, 1000);

      const beneficiary = addr1;
      const startTimeAfterLaunch = timeDuration6Month;
      const cliff = 0;
      const duration = 1000;
      const slicePeriodSeconds = 1;
      const revokable = true;
      const amount = 100;

      // create new vesting schedule
      await tokenVesting.createVestingSchedule(
        beneficiary.address,
        startTimeAfterLaunch,
        cliff,
        duration,
        slicePeriodSeconds,
        revokable,
        amount
      );

      // compute vesting schedule id
      const vestingScheduleId =
        await tokenVesting.computeVestingScheduleIdForAddressAndIndex(
          beneficiary.address,
          0
        );

      // set time to half the vesting period
      const halfTime = launchTime + startTimeAfterLaunch + duration / 2;
      await tokenVesting.setCurrentTime(halfTime);

      await expect(tokenVesting.revoke(vestingScheduleId))
        .to.emit(testToken, "Transfer")
        .withArgs(tokenVesting.address, beneficiary.address, 50);
    });

    it("Should compute vesting schedule index", async function () {
      const tokenVesting = await deployContract("MockTokenVesting", [
        testToken.address,
        launchTime,
      ]);
      await tokenVesting.setCurrentTime(0);
      const expectedVestingScheduleId =
        "0xa279197a1d7a4b7398aa0248e95b8fcc6cdfb43220ade05d01add9c5468ea097";
      expect(
        (
          await tokenVesting.computeVestingScheduleIdForAddressAndIndex(
            addr1.address,
            0
          )
        ).toString()
      ).to.equal(expectedVestingScheduleId);
      expect(
        (
          await tokenVesting.computeNextVestingScheduleIdForHolder(
            addr1.address
          )
        ).toString()
      ).to.equal(expectedVestingScheduleId);
    });

    it("Should check input parameters for createVestingSchedule method", async function () {
      const tokenVesting = await deployContract("MockTokenVesting", [
        testToken.address,
        launchTime,
      ]);
      await tokenVesting.setCurrentTime(0);
      await testToken.transfer(tokenVesting.address, 1000);
      const time = Date.now();
      await expect(
        tokenVesting.createVestingSchedule(
          addr1.address,
          time,
          0,
          0,
          1,
          false,
          1
        )
      ).to.be.revertedWith("tv: duration must > 0");
      await expect(
        tokenVesting.createVestingSchedule(
          addr1.address,
          time,
          0,
          1,
          0,
          false,
          1
        )
      ).to.be.revertedWith("tv: sps must >= 1");
      await expect(
        tokenVesting.createVestingSchedule(
          addr1.address,
          time,
          0,
          1,
          1,
          false,
          0
        )
      ).to.be.revertedWith("tv: amount must > 0");
    });

    it("Get", async function () {
      const tokenVesting = await deployContract("MockTokenVesting", [
        testToken.address,
        launchTime,
      ]);
      await tokenVesting.setCurrentTime(0);
      await testToken.transfer(tokenVesting.address, 1000);
      const time = Date.now();
      await expect(
        tokenVesting.createVestingSchedule(
          addr1.address,
          time,
          0,
          0,
          1,
          false,
          1
        )
      ).to.be.revertedWith("tv: duration must > 0");
      await expect(
        tokenVesting.createVestingSchedule(
          addr1.address,
          time,
          0,
          1,
          0,
          false,
          1
        )
      ).to.be.revertedWith("tv: sps must >= 1");
      await expect(
        tokenVesting.createVestingSchedule(
          addr1.address,
          time,
          0,
          1,
          1,
          false,
          0
        )
      ).to.be.revertedWith("tv: amount must > 0");
    });
  });
});
