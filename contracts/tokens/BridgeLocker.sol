// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../libraries/token/IERC20.sol";
import "../libraries/math/SafeMath.sol";
import "../libraries/token/SafeERC20.sol";
import "../libraries/utils/ReentrancyGuard.sol";

import "../access/Governable.sol";
import "./interfaces/IBridgeLocker.sol";

contract BridgeLocker is IBridgeLocker, ReentrancyGuard, Governable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    address public token;
    uint256 public totalLocked;
    mapping(uint256 => uint256) public override chainLock;
    mapping(uint256 => address) public override chainTokenAddr;
    mapping(address => bool) public isHandler;

    event RegisterChainToken(
        address sender,
        uint256 chainID,
        address tokenAddr
    );
    event Lock(address sender, uint256 amount, uint256 chainID);
    event Unlock(
        address sender,
        uint256 amount,
        uint256 chainID,
        address receiver
    );

    constructor(address _token) public {
        token = _token;
    }

    function setHandler(address _handler, bool _isActive) external onlyGov {
        isHandler[_handler] = _isActive;
    }

    function registerChainToken(
        uint256 _chainID,
        address _tokenAddr
    ) external override nonReentrant {
        _validateHandler();
        chainTokenAddr[_chainID] = _tokenAddr;

        emit RegisterChainToken(msg.sender, _chainID, _tokenAddr);
    }

    function lock(
        uint256 _amount,
        uint256 _chainID
    ) external override nonReentrant {
        _validateHandler();
        chainLock[_chainID] += _amount;
        totalLocked += _amount;

        IERC20(token).safeTransferFrom(msg.sender, address(this), _amount);

        emit Lock(msg.sender, _amount, _chainID);
    }

    function unlock(
        uint256 _amount,
        uint256 _chainID,
        address _receiver
    ) external override nonReentrant onlyGov {
        _validateHandler();
        require(
            chainLock[_chainID] >= _amount,
            "No enough token locked to chain"
        );
        require(totalLocked >= _amount, "No enough token locked");

        chainLock[_chainID] -= _amount;
        totalLocked -= _amount;

        IERC20(token).safeTransfer(_receiver, _amount);

        emit Unlock(msg.sender, _amount, _chainID, _receiver);
    }

    function _validateHandler() private view {
        require(isHandler[msg.sender], "BridgeLocker: forbidden");
    }
}
