// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
pragma abicoder v2;

import {IERC20} from "./interfaces/IERC20.sol";
import {SafeERC20} from "./libraries/SafeERC20.sol";
import {Address} from "./libraries/Address.sol";

import "hardhat/console.sol";

// todo:
// 1. Change the admin to a committee. Ref: https://github.com/nervosnetwork/force-bridge-eth/blob/b1d392bd5b3fb4a800d0eb7614faa4f16ba8e0a9/eth-contracts/contracts/CKBChain.sol#L22-L29

contract ForceBridge {
    using Address for address;
    using SafeERC20 for IERC20;

    address public admin;

    event Locked(
        address indexed token,
        address indexed sender,
        uint256 lockedAmount,
        bytes recipientLockscript,
        bytes sudtExtraData
    );

    event Unlocked(
        address indexed token,
        address indexed recipient,
        address indexed sender,
        uint256 receivedAmount
    );

    struct UnlockRecord {
        address token;
        address recipient;
        uint256 amount;
    }

    modifier onlyAdmin {
    require(
            msg.sender == admin,
            "Only admin can call this function."
        );
        _;
    }

    constructor() { admin = msg.sender; }

    function changeAdmin(address newAdmin) public onlyAdmin {
        admin = newAdmin;
    }

    function unlock(UnlockRecord[] memory records) public onlyAdmin {
        for(uint i=0; i<records.length; i++) {
            if(records[i].amount == 0) continue;
            if (records[i].token == address(0)) {
                payable(records[i].recipient).transfer(records[i].amount);
            } else {
                IERC20(records[i].token).safeTransfer(records[i].recipient, records[i].amount);
            }
            emit Unlocked(records[i].token, records[i].recipient, msg.sender, records[i].amount);
        }
    }

    function lockETH(
        bytes memory recipientLockscript,
        bytes memory sudtExtraData
    ) public payable {
        emit Locked(
            address(0),
            msg.sender,
            msg.value,
            recipientLockscript,
            sudtExtraData
        );
    }

    // before lockToken, user should approve -> TokenLocker Contract with 0xffffff token
    function lockToken(
        address token,
        uint256 amount,
        bytes memory recipientLockscript,
        bytes memory sudtExtraData
    ) public {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit Locked(
            token,
            msg.sender,
            amount,
            recipientLockscript,
            sudtExtraData
        );
    }
}
