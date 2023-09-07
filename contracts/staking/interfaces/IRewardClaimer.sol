// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface IRewardClaimer {
    function claimableAmount(
        address _account,
        address _token
    ) external view returns (uint256);

    function claimForAccount(
        address _account,
        address _receiver,
        address[] memory _claimableTokens
    ) external;

    function claim(
        address _receiver,
        address[] memory _claimableTokens
    ) external;
}
