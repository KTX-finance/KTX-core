// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../tokens/MintableBaseToken.sol";

contract TrKTX is MintableBaseToken {
    constructor() public MintableBaseToken("Trading Reward KTC", "trKTC", 0) {}

    function id() external pure returns (string memory _name) {
        return "trKTC";
    }
}
