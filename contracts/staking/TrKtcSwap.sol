// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../libraries/math/SafeMath.sol";
import "../libraries/token/IERC20.sol";
import "../libraries/token/SafeERC20.sol";
import "../libraries/utils/ReentrancyGuard.sol";
import "./interfaces/ITrKtcSwap.sol";
import "../access/Governable.sol";

import "hardhat/console.sol";

contract TrKtcSwap is ReentrancyGuard, ITrKtcSwap, Governable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    bool public inPrivateSwapMode;
    address public trKtcAddress;
    address public ktcAddress;
    uint256 public rateBps;

    event Swap(address receiver, uint256 amountIn, uint256 amountOut);
    event SetRateBps(uint256 rateBps);

    constructor(address _trKtcAddress, address _ktcAddress) public {
        trKtcAddress = _trKtcAddress;
        ktcAddress = _ktcAddress;
    }

    function setInPrivateSwapMode(bool _inPrivateSwapMode) external onlyGov {
        inPrivateSwapMode = _inPrivateSwapMode;
    }

    function setRateBps(uint256 _rateBps) external onlyGov {
        require(
            _rateBps <= 10000 && _rateBps >= 1,
            "TrKtcSwap: invalid _rateBps"
        );
        rateBps = _rateBps;
        emit SetRateBps(_rateBps);
    }

    function withdrawToken(
        address _token,
        address _account,
        uint256 _amount
    ) external onlyGov {
        IERC20(_token).safeTransfer(_account, _amount);
    }

    function quote(uint256 _amountIn) public view override returns (uint256) {
        return _amountIn.mul(rateBps).div(10000);
    }

    function swapTrKtcForKtc(
        uint256 _amountIn,
        address _to
    ) external override returns (uint256) {
        require(_amountIn > 0, "TrKtcSwap: invalid _amountIn");

        IERC20(trKtcAddress).safeTransferFrom(
            msg.sender,
            address(this),
            _amountIn
        );

        uint256 amountOut = quote(_amountIn);

        require(amountOut > 0, "TrKtcSwap: invalid amountOut");
        IERC20(ktcAddress).safeTransfer(_to, amountOut);
        emit Swap(_to, _amountIn, amountOut);

        return amountOut;
    }
}
