// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface IPositionRouter {
    function createIncreasePositionFromComplexRouter(
        address _account,
        address[] memory _path,
        address _indexToken,
        uint256 _amountIn,
        uint256 _minOut,
        uint256 _sizeDelta,
        bool _isLong,
        uint256 _acceptablePrice,
        uint256 _executionFee,
        bytes32 _referralCode,
        bool _hasCollateralInETH
    ) external;

    function executeIncreasePositions(
        uint256 _count,
        address payable _executionFeeReceiver
    ) external;

    function executeDecreasePositions(
        uint256 _count,
        address payable _executionFeeReceiver
    ) external;
}
