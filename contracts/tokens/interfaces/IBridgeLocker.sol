// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface IBridgeLocker {
    function chainTokenAddr(uint256 _chainID) external view returns (address);

    function chainLock(uint256 _chainID) external view returns (uint256);

    function registerChainToken(uint256 _chainID, address _tokenAddr) external;

    function lock(uint256 _amount, uint256 _chainID) external;

    function unlock(
        uint256 _amount,
        uint256 _chainID,
        address _receiver
    ) external;
}
