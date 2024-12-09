// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../libraries/math/SafeMath.sol";
import "../libraries/token/IERC20.sol";
import "../libraries/token/SafeERC20.sol";
import "../libraries/utils/ReentrancyGuard.sol";
import "../libraries/utils/Address.sol";

import "./interfaces/IRewardTracker.sol";
import "./interfaces/IVester.sol";
import "../tokens/interfaces/IMintable.sol";
import "../tokens/interfaces/IWETH.sol";
import "../core/interfaces/IKlpManager.sol";
import "../access/Governable.sol";

contract RewardRouterSimple is ReentrancyGuard, Governable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using Address for address payable;

    bool public isInitialized;

    address public weth;
    address public klp; // KTX Liquidity Provider token
    address public feeKlpTracker;
    address public klpManager;

    mapping(address => address) public pendingReceivers;

    event StakeKlp(address account, uint256 amount);
    event UnstakeKlp(address account, uint256 amount);

    receive() external payable {
        require(msg.sender == weth, "Router: invalid sender");
    }

    function initialize(
        address _weth,
        address _klp,
        address _feeKlpTracker,
        address _klpManager
    ) external onlyGov {
        require(!isInitialized, "RewardRouter: already initialized");
        isInitialized = true;

        weth = _weth;
        klp = _klp;
        feeKlpTracker = _feeKlpTracker;
        klpManager = _klpManager;
    }

    // to help users who accidentally send their tokens to this contract
    function withdrawToken(
        address _token,
        address _account,
        uint256 _amount
    ) external onlyGov {
        IERC20(_token).safeTransfer(_account, _amount);
    }

    function mintAndStakeKlp(
        address _token,
        uint256 _amount,
        uint256 _minUsdg,
        uint256 _minKlp
    ) external nonReentrant returns (uint256) {
        require(_amount > 0, "RewardRouter: invalid _amount");

        address account = msg.sender;
        uint256 klpAmount = IKlpManager(klpManager).addLiquidityForAccount(
            account,
            account,
            _token,
            _amount,
            _minUsdg,
            _minKlp
        );
        IRewardTracker(feeKlpTracker).stakeForAccount(
            account,
            account,
            klp,
            klpAmount
        );

        emit StakeKlp(account, klpAmount);

        return klpAmount;
    }

    function mintAndStakeKlpETH(
        uint256 _minUsdg,
        uint256 _minKlp
    ) external payable nonReentrant returns (uint256) {
        require(msg.value > 0, "RewardRouter: invalid msg.value");

        IWETH(weth).deposit{value: msg.value}();
        IERC20(weth).approve(klpManager, msg.value);

        address account = msg.sender;
        uint256 klpAmount = IKlpManager(klpManager).addLiquidityForAccount(
            address(this),
            account,
            weth,
            msg.value,
            _minUsdg,
            _minKlp
        );

        IRewardTracker(feeKlpTracker).stakeForAccount(
            account,
            account,
            klp,
            klpAmount
        );

        emit StakeKlp(account, klpAmount);

        return klpAmount;
    }

    function unstakeAndRedeemKlp(
        address _tokenOut,
        uint256 _klpAmount,
        uint256 _minOut,
        address _receiver
    ) external nonReentrant returns (uint256) {
        require(_klpAmount > 0, "RewardRouter: invalid _klpAmount");

        address account = msg.sender;
        IRewardTracker(feeKlpTracker).unstakeForAccount(
            account,
            klp,
            _klpAmount,
            account
        );
        uint256 amountOut = IKlpManager(klpManager).removeLiquidityForAccount(
            account,
            _tokenOut,
            _klpAmount,
            _minOut,
            _receiver
        );

        emit UnstakeKlp(account, _klpAmount);

        return amountOut;
    }

    function unstakeAndRedeemKlpETH(
        uint256 _klpAmount,
        uint256 _minOut,
        address payable _receiver
    ) external nonReentrant returns (uint256) {
        require(_klpAmount > 0, "RewardRouter: invalid _klpAmount");

        address account = msg.sender;
        IRewardTracker(feeKlpTracker).unstakeForAccount(
            account,
            klp,
            _klpAmount,
            account
        );
        uint256 amountOut = IKlpManager(klpManager).removeLiquidityForAccount(
            account,
            weth,
            _klpAmount,
            _minOut,
            address(this)
        );

        IWETH(weth).withdraw(amountOut);
        _receiver.sendValue(amountOut);

        emit UnstakeKlp(account, _klpAmount);
        return amountOut;
    }

    function claim() external nonReentrant {
        address account = msg.sender;
        IRewardTracker(feeKlpTracker).claimForAccount(account, account);
    }

    function handleRewards(
        bool _shouldClaimWeth,
        bool _shouldConvertWethToEth
    ) external nonReentrant {
        address account = msg.sender;

        if (_shouldClaimWeth) {
            if (_shouldConvertWethToEth) {
                uint256 wethAmount = IRewardTracker(feeKlpTracker)
                    .claimForAccount(account, address(this));

                IWETH(weth).withdraw(wethAmount);

                payable(account).sendValue(wethAmount);
            } else {
                IRewardTracker(feeKlpTracker).claimForAccount(account, account);
            }
        }
    }

    function signalTransfer(address _receiver) external nonReentrant {
        _validateReceiver(_receiver);
        pendingReceivers[msg.sender] = _receiver;
    }

    function acceptTransfer(address _sender) external nonReentrant {
        address receiver = msg.sender;
        require(
            pendingReceivers[_sender] == receiver,
            "RewardRouter: transfer not signalled"
        );
        delete pendingReceivers[_sender];

        _validateReceiver(receiver);

        uint256 klpAmount = IRewardTracker(feeKlpTracker).depositBalances(
            _sender,
            klp
        );
        if (klpAmount > 0) {
            IRewardTracker(feeKlpTracker).unstakeForAccount(
                _sender,
                klp,
                klpAmount,
                _sender
            );
            IRewardTracker(feeKlpTracker).stakeForAccount(
                _sender,
                receiver,
                klp,
                klpAmount
            );
        }
    }

    function _validateReceiver(address _receiver) private view {
        require(
            IRewardTracker(feeKlpTracker).averageStakedAmounts(_receiver) == 0,
            "RewardRouter: feeKlpTracker.averageStakedAmounts > 0"
        );
        require(
            IRewardTracker(feeKlpTracker).cumulativeRewards(_receiver) == 0,
            "RewardRouter: feeKlpTracker.cumulativeRewards > 0"
        );
    }
}
