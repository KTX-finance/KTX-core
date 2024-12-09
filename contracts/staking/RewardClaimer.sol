// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../libraries/math/SafeMath.sol";
import "../libraries/token/IERC20.sol";
import "../libraries/token/SafeERC20.sol";
import "../libraries/utils/ReentrancyGuard.sol";

import "./interfaces/IRewardClaimer.sol";
import "../access/Governable.sol";

import "hardhat/console.sol";

contract RewardClaimer is ReentrancyGuard, IRewardClaimer, Governable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    bool public inPrivateClaimingMode;
    uint256 public expiryTime;

    mapping(address => bool) public isClaimableToken;
    mapping(address => bool) public isHandler;
    mapping(address => mapping(address => uint256)) public userClaimableAmounts;
    mapping(address => mapping(address => uint256)) public userAccumAmounts;
    mapping(address => uint256) public totalClaimableAmount;
    mapping(address => uint256) public accumClaimableAmount;

    event Claim(address receiver, address token, uint256 amount);
    event SetExpiryTime(uint256 expiryTime);
    event IncreaseClaimableToken(address user, address token, uint256 amount);
    event DecreaseClaimableToken(address user, address token, uint256 amount);

    constructor(address[] memory _claimableTokens) public {
        for (uint256 i = 0; i < _claimableTokens.length; i++) {
            address claimableToken = _claimableTokens[i];
            isClaimableToken[claimableToken] = true;
        }
    }

    function setClaimableToken(
        address _claimableToken,
        bool _isClaimableToken
    ) external onlyGov {
        isClaimableToken[_claimableToken] = _isClaimableToken;
    }

    function setHandler(address _handler, bool _isActive) external onlyGov {
        isHandler[_handler] = _isActive;
    }

    function setInPrivateClaimingMode(
        bool _inPrivateClaimingMode
    ) external onlyGov {
        inPrivateClaimingMode = _inPrivateClaimingMode;
    }

    function setExpiryTime(uint256 _expiryTime) external onlyGov {
        expiryTime = _expiryTime;
        emit SetExpiryTime(_expiryTime);
    }

    // to help users who accidentally send their tokens to this contract
    function withdrawToken(
        address _token,
        address _account,
        uint256 _amount
    ) external onlyGov {
        IERC20(_token).safeTransfer(_account, _amount);
    }

    function claim(
        address _receiver,
        address[] memory _claimableTokens
    ) external override nonReentrant {
        if (inPrivateClaimingMode) {
            revert("RewardClaimer: action not enabled");
        }
        _claim(msg.sender, _receiver, _claimableTokens);
    }

    function claimForAccount(
        address _account,
        address _receiver,
        address[] memory _claimableTokens
    ) external override nonReentrant {
        _validateHandler();
        _claim(_account, _receiver, _claimableTokens);
    }

    function claimableAmount(
        address _account,
        address _token
    ) external view override returns (uint256) {
        return userClaimableAmounts[_account][_token];
    }

    function accumAmount(
        address _account,
        address _token
    ) external view override returns (uint256) {
        return userAccumAmounts[_account][_token];
    }

    function _claim(
        address _account,
        address _receiver,
        address[] memory _claimableTokens
    ) private {
        _validateExpiry();

        for (uint256 i = 0; i < _claimableTokens.length; i++) {
            address token = _claimableTokens[i];
            require(isClaimableToken[token], "RewardClaimer: invalid token");

            uint256 amount = userClaimableAmounts[_account][token];
            userClaimableAmounts[_account][token] = 0;
            totalClaimableAmount[token] = totalClaimableAmount[token].sub(
                amount
            );

            if (amount > 0) {
                IERC20(token).safeTransfer(_receiver, amount);
                emit Claim(_account, token, amount);
            }
        }
    }

    function increaseClaimableAmounts(
        address _token,
        address[] memory _accounts,
        uint256[] memory _amounts
    ) external {
        require(
            _accounts.length == _amounts.length,
            "RewardClaimer: invalid param"
        );
        _validateHandler();

        for (uint256 i = 0; i < _accounts.length; i++) {
            address account = _accounts[i];
            require(account != address(0), "RewardClaimer: zero address");

            uint256 amount = _amounts[i];
            // require(
            //     this.getWithdrawableAmount(_token) >= amount,
            //     "RewardClaimer: no enough token"
            // );

            totalClaimableAmount[_token] = totalClaimableAmount[_token].add(
                amount
            );
            userClaimableAmounts[account][_token] = userClaimableAmounts[
                account
            ][_token].add(amount);

            accumClaimableAmount[_token] = accumClaimableAmount[_token].add(
                amount
            );
            userAccumAmounts[account][_token] = userAccumAmounts[account][
                _token
            ].add(amount);

            emit IncreaseClaimableToken(account, _token, amount);
        }
    }

    function decreaseClaimableAmounts(
        address _token,
        address[] memory _accounts,
        uint256[] memory _amounts
    ) external {
        require(
            _accounts.length == _amounts.length,
            "RewardClaimer: invalid param"
        );
        _validateHandler();

        for (uint256 i = 0; i < _accounts.length; i++) {
            address account = _accounts[i];
            require(account != address(0), "RewardClaimer:  zero address");

            uint256 amount = _amounts[i];
            totalClaimableAmount[_token] = totalClaimableAmount[_token].sub(
                amount
            );
            userClaimableAmounts[account][_token] = userClaimableAmounts[
                account
            ][_token].sub(amount);

            accumClaimableAmount[_token] = accumClaimableAmount[_token].sub(
                amount
            );
            userAccumAmounts[account][_token] = userAccumAmounts[account][
                _token
            ].sub(amount);

            emit DecreaseClaimableToken(account, _token, amount);
        }
    }

    function getWithdrawableAmount(
        address _token
    ) public view returns (uint256) {
        return
            IERC20(_token).balanceOf(address(this)).sub(
                totalClaimableAmount[_token]
            );
    }

    function _validateHandler() private view {
        require(isHandler[msg.sender], "RewardClaimer: forbidden");
    }

    function _validateExpiry() private view {
        if (expiryTime != 0) {
            require(expiryTime > block.timestamp, "RewardClaimer: expired");
        }
    }
}
