// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../libraries/math/SafeMath.sol";
import "./interfaces/IPriceFeed.sol";
import "@api3/contracts/v0.6/interfaces/IProxy.sol";

contract MantlePriceFeedMeth is IPriceFeed {
    using SafeMath for uint256;
    using SafeMath for uint64;

    address public gov;
    string public override description = "PriceFeed";
    address public override aggregator;
    uint256 public decimals;

    address public ethToUsdProxy; // 0x009e9b1eec955e9fe7fe64f80ae868e661cb4729
    address public methToEthProxy; // 0xf55fabdf4c4f19d48d12a94209c735ca5ac43c78

    constructor(address _ethToUsdProxy, address _methToEthProxy) public {
        gov = msg.sender;
        ethToUsdProxy = _ethToUsdProxy;
        methToEthProxy = _methToEthProxy;
    }

    function setMantlePriceFeedAddress(
        address _ethToUsdProxy,
        address _methToEthProxy
    ) public {
        require(msg.sender == gov, "PriceFeed: forbidden");
        ethToUsdProxy = _ethToUsdProxy;
        methToEthProxy = _methToEthProxy;
    }

    function readDataFeed()
        internal
        view
        returns (int224 value, uint256 timestamp)
    {
        (int224 ethValueInUsd, uint256 ethToUsdTimestamp) = IProxy(
            ethToUsdProxy
        ).read();
        (int224 methValueInEth, uint256 methToEthTimestamp) = IProxy(
            methToEthProxy
        ).read();
        value = (methValueInEth * ethValueInUsd) / (10 ** 18);
        // use oldest timestamp
        timestamp = ethToUsdTimestamp > methToEthTimestamp
            ? methToEthTimestamp
            : ethToUsdTimestamp;
    }

    function latestAnswer() public view override returns (int256 value) {
        (value, ) = readDataFeed();

        return value / (10 ** 10);
    }

    function latestTimestamp() external view returns (uint256 timestamp) {
        (, timestamp) = readDataFeed();
    }

    function latestRound() public view override returns (uint80) {
        return 1;
    }

    function setLatestAnswer(int256) public pure {
        return revert("MantlePriceFeed: function not implemented");
    }

    // returns roundId, answer, startedAt, updatedAt, answeredInRound
    function getRoundData(
        uint80 _roundId
    ) public view override returns (uint80, int256, uint256, uint256, uint80) {
        return (_roundId, latestAnswer(), 0, 0, 0);
    }
}
