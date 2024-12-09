// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface ITrKtcSwap {
    function quote(uint256 _amountIn) external view returns (uint256);

    function swapTrKtcForKtc(
        uint256 _amountIn,
        address _to
    ) external returns (uint256);
}
