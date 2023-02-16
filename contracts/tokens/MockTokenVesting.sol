// contracts/mock/MockTokenVesting.sol
// SPDX-License-Identifier: Apache-2.0
pragma experimental ABIEncoderV2;
pragma solidity 0.6.12;

import "./TokenVesting.sol";

/**
 * @title MockTokenVesting
 * WARNING: use only for testing and debugging purpose
 */
contract MockTokenVesting is TokenVesting {
    uint256 mockTime;

    constructor(
        address _token,
        uint256 _launchTime
    ) public TokenVesting(_token, _launchTime) {}

    function setCurrentTime(uint256 _time) external {
        mockTime = _time;
    }

    function getCurrentTime() internal view virtual override returns (uint256) {
        return mockTime;
    }
}
