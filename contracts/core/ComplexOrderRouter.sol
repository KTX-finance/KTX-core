// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;

import "../libraries/math/SafeMath.sol";
import "../tokens/interfaces/IWETH.sol";
import "../libraries/token/SafeERC20.sol";
import "../libraries/utils/Address.sol";
import "../libraries/token/IERC20.sol";

import "./interfaces/IPositionRouter.sol";
import "./interfaces/IOrderBook.sol";
import "../libraries/utils/ReentrancyGuard.sol";

import "../access/Governable.sol";

contract ComplexOrderRouter is ReentrancyGuard, Governable {
    using SafeMath for uint256;
    using Address for address payable;
    using SafeERC20 for IERC20;

    address public orderbook;
    address public positionRouter;
    address public weth;

    event CreateComplexOrder(
        address account,
        address[] _path,
        uint256 _amountIn,
        uint256 _minOut,
        bool _isLong,
        bytes32 _referralCode,
        uint256[] _sizeDelta,
        uint256[] _price,
        address[] _token,
        uint256[] _executionFee
    );

    event CreateComplexLimitOrder(
        address account,
        address[] _path,
        uint256 _amountIn,
        bool _isLong,
        address _indexToken,
        bool _triggerAboveThreshold,
        uint256[] _sizeDelta,
        uint256[] _price,
        address[] _token,
        uint256[] _executionFee
    );

    constructor(
        address payable _orderbook,
        address payable _positionRouter,
        address _weth
    ) public {
        orderbook = _orderbook;
        positionRouter = _positionRouter;
        weth = _weth;
    }

    receive() external payable {
        require(msg.sender == weth, "ComplexOrderRouter: invalid sender");
    }

    function withdrawFees(
        address _token,
        address _receiver,
        uint256 _amount
    ) external onlyGov {
        IERC20(_token).safeTransfer(_receiver, _amount);
    }

    function withdrawFeesETH(
        address payable _receiver,
        uint256 _amount
    ) external onlyGov {
        IWETH(weth).withdraw(_amount);
        _receiver.sendValue(_amount);
    }

    function _transferInETH() internal {
        if (msg.value != 0) {
            IWETH(weth).deposit{value: msg.value}();
        }
    }

    function _transferOutETH(
        uint256 _amountOut,
        address payable _receiver
    ) internal {
        IWETH(weth).withdraw(_amountOut);
        _receiver.sendValue(_amountOut);
    }

    function createComplexOrder(
        address[] memory _path,
        uint256 _amountIn,
        uint256 _minOut,
        bool _isLong,
        bytes32 _referralCode,
        uint256[] memory _sizeDelta,
        uint256[] memory _price,
        address[] memory _token,
        uint256[] memory _executionFee
    ) external payable nonReentrant {
        require(
            _sizeDelta.length == 3,
            "ComplexOrderRouter: invalid _sizeDelta length"
        );
        require(
            _price.length == 3,
            "ComplexOrderRouter: invalid _price length"
        );
        require(
            _token.length == 3,
            "ComplexOrderRouter: invalid _token length"
        );
        require(
            _executionFee.length == 3,
            "ComplexOrderRouter: invalid _executionFee length"
        );
        require(
            _path.length == 1 || _path.length == 2,
            "ComplexOrderRouter: invalid _path length"
        );
        require(
            msg.value >=
                _executionFee[0].add(_executionFee[1]).add(_executionFee[2]),
            "ComplexOrderRouter: invalid msg.value"
        );

        _transferInETH();
        _transferOutETH(_executionFee[0], payable(positionRouter));
        IPositionRouter(positionRouter).createIncreasePositionFromComplexRouter(
                msg.sender,
                _path,
                _token[0],
                _amountIn,
                _minOut,
                _sizeDelta[0],
                _isLong,
                _price[0],
                _executionFee[0],
                _referralCode,
                false
            );

        if (_sizeDelta[1] > 0) {
            _transferOutETH(_executionFee[1], payable(orderbook));
            IOrderBook(orderbook).createDecreaseOrderComplex(
                msg.sender,
                _token[0],
                _sizeDelta[1],
                _token[1],
                0,
                _isLong,
                _price[1],
                _isLong,
                _executionFee[1]
            );
        }
        if (_sizeDelta[2] > 0) {
            _transferOutETH(_executionFee[2], payable(orderbook));
            IOrderBook(orderbook).createDecreaseOrderComplex(
                msg.sender,
                _token[0],
                _sizeDelta[2],
                _token[2],
                0,
                _isLong,
                _price[2],
                !_isLong,
                _executionFee[2]
            );
        }

        emit CreateComplexOrder(
            msg.sender,
            _path,
            _amountIn,
            _minOut,
            _isLong,
            _referralCode,
            _sizeDelta,
            _price,
            _token,
            _executionFee
        );
    }

    function createComplexOrderETH(
        address[] memory _path,
        uint256 _minOut,
        bool _isLong,
        bytes32 _referralCode,
        uint256[] memory _sizeDelta,
        uint256[] memory _price,
        address[] memory _token,
        uint256[] memory _executionFee
    ) external payable nonReentrant {
        require(
            _sizeDelta.length == 3,
            "ComplexOrderRouter: invalid _sizeDelta length"
        );
        require(
            _price.length == 3,
            "ComplexOrderRouter: invalid _price length"
        );
        require(
            _token.length == 3,
            "ComplexOrderRouter: invalid _token length"
        );
        require(
            _executionFee.length == 3,
            "ComplexOrderRouter: invalid _executionFee length"
        );
        require(
            _path.length == 1 || _path.length == 2,
            "ComplexOrderRouter: invalid _path length"
        );
        require(
            msg.value >=
                _executionFee[0].add(_executionFee[1]).add(_executionFee[2]),
            "ComplexOrderRouter: invalid msg.value"
        );
        require(_path[0] == weth, "ComplexOrderRouter: invalid _path");

        _transferInETH();
        _transferOutETH(
            msg.value.sub(_executionFee[1]).sub(_executionFee[2]),
            payable(positionRouter)
        );
        IPositionRouter(positionRouter).createIncreasePositionFromComplexRouter(
                msg.sender,
                _path,
                _token[0],
                msg.value.sub(_executionFee[0]).sub(_executionFee[1]).sub(
                    _executionFee[2]
                ),
                _minOut,
                _sizeDelta[0],
                _isLong,
                _price[0],
                _executionFee[0],
                _referralCode,
                true
            );

        if (_sizeDelta[1] > 0) {
            _transferOutETH(_executionFee[1], payable(orderbook));
            IOrderBook(orderbook).createDecreaseOrderComplex(
                msg.sender,
                _token[0],
                _sizeDelta[1],
                _token[1],
                0,
                _isLong,
                _price[1],
                _isLong,
                _executionFee[1]
            );
        }
        if (_sizeDelta[2] > 0) {
            _transferOutETH(_executionFee[2], payable(orderbook));
            IOrderBook(orderbook).createDecreaseOrderComplex(
                msg.sender,
                _token[0],
                _sizeDelta[2],
                _token[2],
                0,
                _isLong,
                _price[2],
                !_isLong,
                _executionFee[2]
            );
        }
        emit CreateComplexOrder(
            msg.sender,
            _path,
            msg.value.sub(_executionFee[0]).sub(_executionFee[1]).sub(
                _executionFee[2]
            ),
            _minOut,
            _isLong,
            _referralCode,
            _sizeDelta,
            _price,
            _token,
            _executionFee
        );
    }

    function createComplexLimitOrder(
        address[] memory _path,
        uint256 _amountIn,
        uint256 _minOut,
        bool _isLong,
        address _indexToken,
        bool _triggerAboveThreshold,
        uint256[] memory _sizeDelta,
        uint256[] memory _price,
        address[] memory _token,
        uint256[] memory _executionFee
    ) external payable nonReentrant {
        require(
            _sizeDelta.length == 3,
            "ComplexOrderRouter: invalid _sizeDelta length"
        );
        require(
            _price.length == 3,
            "ComplexOrderRouter: invalid _price length"
        );
        require(
            _token.length == 3,
            "ComplexOrderRouter: invalid _token length"
        );
        require(
            _executionFee.length == 3,
            "ComplexOrderRouter: invalid _executionFee length"
        );
        require(
            msg.value >=
                _executionFee[0].add(_executionFee[1]).add(_executionFee[2]),
            "ComplexOrderRouter: invalid msg.value"
        );

        _transferInETH();
        _transferOutETH(_executionFee[0], payable(orderbook));
        IOrderBook(orderbook).createIncreaseOrderComplex(
            msg.sender,
            _path,
            _amountIn,
            _indexToken,
            _minOut,
            _sizeDelta[0],
            _token[0],
            _isLong,
            _price[0],
            _triggerAboveThreshold,
            _executionFee[0],
            false
        );

        if (_sizeDelta[1] > 0) {
            _transferOutETH(_executionFee[1], payable(orderbook));
            IOrderBook(orderbook).createDecreaseOrderComplex(
                msg.sender,
                _indexToken,
                _sizeDelta[1],
                _token[1],
                0,
                _isLong,
                _price[1],
                _isLong,
                _executionFee[1]
            );
        }
        if (_sizeDelta[2] > 0) {
            _transferOutETH(_executionFee[2], payable(orderbook));
            IOrderBook(orderbook).createDecreaseOrderComplex(
                msg.sender,
                _indexToken,
                _sizeDelta[2],
                _token[2],
                0,
                _isLong,
                _price[2],
                !_isLong,
                _executionFee[2]
            );
        }

        emit CreateComplexLimitOrder(
            msg.sender,
            _path,
            _amountIn,
            _isLong,
            _indexToken,
            _triggerAboveThreshold,
            _sizeDelta,
            _price,
            _token,
            _executionFee
        );
    }

    function createComplexLimitOrderETH(
        address[] memory _path,
        uint256 _minOut,
        bool _isLong,
        address _indexToken,
        bool _triggerAboveThreshold,
        uint256[] memory _sizeDelta,
        uint256[] memory _price,
        address[] memory _token,
        uint256[] memory _executionFee
    ) external payable nonReentrant {
        require(
            _sizeDelta.length == 3,
            "ComplexOrderRouter: invalid _sizeDelta length"
        );
        require(
            _price.length == 3,
            "ComplexOrderRouter: invalid _price length"
        );
        require(
            _token.length == 3,
            "ComplexOrderRouter: invalid _token length"
        );
        require(
            _executionFee.length == 3,
            "ComplexOrderRouter: invalid _executionFee length"
        );
        require(
            msg.value >=
                _executionFee[0].add(_executionFee[1]).add(_executionFee[2]),
            "ComplexOrderRouter: invalid msg.value"
        );
        require(_path[0] == weth, "ComplexOrderRouter: invalid _path");
        _transferInETH();
        _transferOutETH(
            msg.value.sub(_executionFee[1]).sub(_executionFee[2]),
            payable(orderbook)
        );
        IOrderBook(orderbook).createIncreaseOrderComplex(
            msg.sender,
            _path,
            msg.value.sub(_executionFee[0]).sub(_executionFee[1]).sub(
                _executionFee[2]
            ),
            _indexToken,
            _minOut,
            _sizeDelta[0],
            _token[0],
            _isLong,
            _price[0],
            _triggerAboveThreshold,
            _executionFee[0],
            true
        );

        if (_sizeDelta[1] > 0) {
            _transferOutETH(_executionFee[1], payable(orderbook));
            IOrderBook(orderbook).createDecreaseOrderComplex(
                msg.sender,
                _indexToken,
                _sizeDelta[1],
                _token[1],
                0,
                _isLong,
                _price[1],
                _isLong,
                _executionFee[1]
            );
        }
        if (_sizeDelta[2] > 0) {
            _transferOutETH(_executionFee[2], payable(orderbook));
            IOrderBook(orderbook).createDecreaseOrderComplex(
                msg.sender,
                _indexToken,
                _sizeDelta[2],
                _token[2],
                0,
                _isLong,
                _price[2],
                !_isLong,
                _executionFee[2]
            );
        }

        emit CreateComplexLimitOrder(
            msg.sender,
            _path,
            msg.value.sub(_executionFee[0]).sub(_executionFee[1]).sub(
                _executionFee[2]
            ),
            _isLong,
            _indexToken,
            _triggerAboveThreshold,
            _sizeDelta,
            _price,
            _token,
            _executionFee
        );
    }
}
