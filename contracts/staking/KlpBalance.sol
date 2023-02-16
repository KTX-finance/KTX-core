// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../libraries/math/SafeMath.sol";
import "../libraries/token/IERC20.sol";
import "../core/interfaces/IKlpManager.sol";

contract KlpBalance {
    using SafeMath for uint256;

    IKlpManager public klpManager;
    address public stakedKlpTracker;

    mapping (address => mapping (address => uint256)) public allowances;

    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(
        IKlpManager _klpManager,
        address _stakedKlpTracker
    ) public {
        klpManager = _klpManager;
        stakedKlpTracker = _stakedKlpTracker;
    }

    function allowance(address _owner, address _spender) external view returns (uint256) {
        return allowances[_owner][_spender];
    }

    function approve(address _spender, uint256 _amount) external returns (bool) {
        _approve(msg.sender, _spender, _amount);
        return true;
    }

    function transfer(address _recipient, uint256 _amount) external returns (bool) {
        _transfer(msg.sender, _recipient, _amount);
        return true;
    }

    function transferFrom(address _sender, address _recipient, uint256 _amount) external returns (bool) {
        uint256 nextAllowance = allowances[_sender][msg.sender].sub(_amount, "KlpBalance: transfer amount exceeds allowance");
        _approve(_sender, msg.sender, nextAllowance);
        _transfer(_sender, _recipient, _amount);
        return true;
    }

    function _approve(address _owner, address _spender, uint256 _amount) private {
        require(_owner != address(0), "KlpBalance: approve from the zero address");
        require(_spender != address(0), "KlpBalance: approve to the zero address");

        allowances[_owner][_spender] = _amount;

        emit Approval(_owner, _spender, _amount);
    }

    function _transfer(address _sender, address _recipient, uint256 _amount) private {
        require(_sender != address(0), "KlpBalance: transfer from the zero address");
        require(_recipient != address(0), "KlpBalance: transfer to the zero address");

        require(
            klpManager.lastAddedAt(_sender).add(klpManager.cooldownDuration()) <= block.timestamp,
            "KlpBalance: cooldown duration not yet passed"
        );

        IERC20(stakedKlpTracker).transferFrom(_sender, _recipient, _amount);
    }
}
