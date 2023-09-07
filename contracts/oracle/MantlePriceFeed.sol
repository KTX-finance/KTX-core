// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../libraries/math/SafeMath.sol";
import "./interfaces/IPriceFeed.sol";
import "./interfaces/IPyth.sol";
import "./interfaces/PythStructs.sol";

contract MantlePriceFeed is IPriceFeed {
    using SafeMath for uint256;
    using SafeMath for uint64;

    address public gov;
    string public override description = "PriceFeed";
    address public override aggregator;
    uint256 public decimals;

    address public mantlePriceFeedAddress;
    bytes32 public priceFeedID;
    uint256 public staleAge = 300;

    constructor() public {
        gov = msg.sender;
    }

    function setMantlePriceFeedAddress(address _address) public {
        require(msg.sender == gov, "PriceFeed: forbidden");
        mantlePriceFeedAddress = _address;
    }

    function setPriceFeedID(bytes32 _id) public {
        require(msg.sender == gov, "PriceFeed: forbidden");
        priceFeedID = _id;
    }

    function setStaleAge(uint256 _staleAge) public {
        require(msg.sender == gov, "PriceFeed: forbidden");
        staleAge = _staleAge;
    }

    function latestAnswer() public view override returns (int256) {
        IPyth pyth = IPyth(mantlePriceFeedAddress);
        // PythStructs.Price memory currentBasePrice = pyth.getPriceNoOlderThan(
        //     priceFeedID,
        //     staleAge
        // );
        PythStructs.Price memory currentBasePrice = pyth.getPriceUnsafe(
            priceFeedID
        );
        uint256 exponent = uint256(currentBasePrice.expo * -1); //将负数转化成uint256类型正数计算
        uint256 price = uint256(currentBasePrice.price).mul(10 ** 8).div(
            10 ** exponent
        );
        return int256(price);
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
