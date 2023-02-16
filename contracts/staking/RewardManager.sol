// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../access/Governable.sol";
import "../peripherals/interfaces/ITimelock.sol";

contract RewardManager is Governable {
    bool public isInitialized;

    ITimelock public timelock;
    address public rewardRouter;

    address public klpManager;

    address public stakedKtxTracker;
    address public bonusKtxTracker;
    address public feeKtxTracker;

    address public feeKlpTracker;
    address public stakedKlpTracker;

    address public stakedKtxDistributor;
    address public stakedKlpDistributor;

    address public esKtx;
    address public bnKtx;

    address public ktxVester;
    address public klpVester;

    function initialize(
        ITimelock _timelock,
        address _rewardRouter,
        address _klpManager,
        address _stakedKtxTracker,
        address _bonusKtxTracker,
        address _feeKtxTracker,
        address _feeKlpTracker,
        address _stakedKlpTracker,
        address _stakedKtxDistributor,
        address _stakedKlpDistributor,
        address _esKtx,
        address _bnKtx,
        address _ktxVester,
        address _klpVester
    ) external onlyGov {
        require(!isInitialized, "RewardManager: already initialized");
        isInitialized = true;

        timelock = _timelock;
        rewardRouter = _rewardRouter;

        klpManager = _klpManager;

        stakedKtxTracker = _stakedKtxTracker;
        bonusKtxTracker = _bonusKtxTracker;
        feeKtxTracker = _feeKtxTracker;

        feeKlpTracker = _feeKlpTracker;
        stakedKlpTracker = _stakedKlpTracker;

        stakedKtxDistributor = _stakedKtxDistributor;
        stakedKlpDistributor = _stakedKlpDistributor;

        esKtx = _esKtx;
        bnKtx = _bnKtx;

        ktxVester = _ktxVester;
        klpVester = _klpVester;
    }

    function updateEsKtxHandlers() external onlyGov {
        timelock.managedSetHandler(esKtx, rewardRouter, true);
        timelock.managedSetHandler(esKtx, stakedKtxDistributor, true);
        timelock.managedSetHandler(esKtx, stakedKlpDistributor, true);
        timelock.managedSetHandler(esKtx, stakedKtxTracker, true);
        timelock.managedSetHandler(esKtx, stakedKlpTracker, true);
        timelock.managedSetHandler(esKtx, ktxVester, true);
        timelock.managedSetHandler(esKtx, klpVester, true);
    }

    function enableRewardRouter() external onlyGov {
        timelock.managedSetHandler(klpManager, rewardRouter, true);

        timelock.managedSetHandler(stakedKtxTracker, rewardRouter, true);
        timelock.managedSetHandler(bonusKtxTracker, rewardRouter, true);
        timelock.managedSetHandler(feeKtxTracker, rewardRouter, true);

        timelock.managedSetHandler(feeKlpTracker, rewardRouter, true);
        timelock.managedSetHandler(stakedKlpTracker, rewardRouter, true);

        timelock.managedSetHandler(esKtx, rewardRouter, true);

        timelock.managedSetMinter(bnKtx, rewardRouter, true);

        timelock.managedSetMinter(esKtx, ktxVester, true);
        timelock.managedSetMinter(esKtx, klpVester, true);

        timelock.managedSetHandler(ktxVester, rewardRouter, true);
        timelock.managedSetHandler(klpVester, rewardRouter, true);

        timelock.managedSetHandler(feeKtxTracker, ktxVester, true);
        timelock.managedSetHandler(stakedKlpTracker, klpVester, true);
    }
}
