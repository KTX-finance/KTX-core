// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../tokens/MintableBaseToken.sol";

contract KLP is MintableBaseToken {
    constructor() public MintableBaseToken("KTC LP", "KLP", 0) {}

    function id() external pure returns (string memory _name) {
        return "KLP";
    }
}
