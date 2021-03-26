// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
pragma abicoder v2;

import {IERC20} from "./interfaces/IERC20.sol";
import {SafeERC20} from "./libraries/SafeERC20.sol";
import {Address} from "./libraries/Address.sol";
import {MultisigUtils} from "./libraries/MultisigUtils.sol";

import "hardhat/console.sol";

// todo:
// 1. Change the admin to a committee. Ref: https://github.com/nervosnetwork/force-bridge-eth/blob/b1d392bd5b3fb4a800d0eb7614faa4f16ba8e0a9/eth-contracts/contracts/CKBChain.sol#L22-L29

contract ForceBridge {
    using Address for address;
    using SafeERC20 for IERC20;

    address public admin;

    // refer to https://github.com/ethereum/EIPs/blob/master/EIPS/eip-712.md
    uint256 public constant SIGNATURE_SIZE = 65;
    uint256 public constant VALIDATORS_SIZE_LIMIT = 20;
    string public constant NAME_712 = "Force Bridge";
    // if the number of verified signatures has reached `multisigThreshold_`, validators approve the tx
    uint256 public multisigThreshold_;
    address[] validators_;

    // UNLOCK_TYPEHASH = keccak256("unlock(UnlockRecord[] calldata records)");
    bytes32 public constant UNLOCK_TYPEHASH =
        0xf1c18f82536658c0cb1a208d4a52b9915dc9e75640ed0daf3a6be45d02ca5c9f;
    // SET_NEW_VALIDATORS_TYPEHASH = keccak256("changeValidators(address[] validators, uint256 multisigThreshold)");
    bytes32 public constant CHANGE_VALIDATORS_TYPEHASH = 
        0xd2cedd075bf1780178b261ac9c9000261e7fd88d66f6309124bddf24f5d953f8;

    bytes32 private _CACHED_DOMAIN_SEPARATOR;
    uint256 private _CACHED_CHAIN_ID;
    bytes32 private _HASHED_NAME;
    bytes32 private _HASHED_VERSION;
    bytes32 private _TYPE_HASH;

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
        uint256 receivedAmount,
        bytes ckbTxHash
    );

    struct UnlockRecord {
        address token;
        address recipient;
        uint256 amount;
        bytes ckbTxHash;
    }

    constructor(address[] memory validators, uint256 multisigThreshold) {
        // set DOMAIN_SEPARATOR
        bytes32 hashedName = keccak256(bytes(NAME_712));
        bytes32 hashedVersion = keccak256(bytes("1"));
        bytes32 typeHash = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
        _HASHED_NAME = hashedName;
        _HASHED_VERSION = hashedVersion;
        _CACHED_CHAIN_ID = _getChainId();
        _CACHED_DOMAIN_SEPARATOR = _buildDomainSeparator(typeHash, hashedName, hashedVersion);
        _TYPE_HASH = typeHash;

        // set validators
        require(
            validators.length <= VALIDATORS_SIZE_LIMIT,
            "number of validators exceeds the limit"
        );
        validators_ = validators;
        require(
            multisigThreshold <= validators.length,
            "invalid multisigThreshold"
        );
        multisigThreshold_ = multisigThreshold;
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparator();
    }

    /**
     * @dev Returns the domain separator for the current chain.
     */
    function _domainSeparator() internal view virtual returns (bytes32) {
        if (_getChainId() == _CACHED_CHAIN_ID) {
            return _CACHED_DOMAIN_SEPARATOR;
        } else {
            return _buildDomainSeparator(_TYPE_HASH, _HASHED_NAME, _HASHED_VERSION);
        }
    }

    function _buildDomainSeparator(bytes32 typeHash, bytes32 name, bytes32 version) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                typeHash,
                name,
                version,
                _getChainId(),
                address(this)
            )
        );
    }

    function _getChainId() private view returns (uint256 chainId) {
        this; // silence state mutability warning without generating bytecode - see https://github.com/ethereum/solidity/issues/2691
        // solhint-disable-next-line no-inline-assembly
        assembly {
            chainId := chainid()
        }
    }

    function changeValidators(
        address[] memory validators,
        uint256 multisigThreshold,
        bytes memory signatures
    ) public {
        require(
            validators.length <= VALIDATORS_SIZE_LIMIT,
            "number of validators exceeds the limit"
        );
        require(
            multisigThreshold <= validators.length,
            "invalid multisigThreshold"
        );
        bytes32 msgHash =
            keccak256(
                abi.encodePacked(
                    "\x19\x01", // solium-disable-line
                    _domainSeparator(),
                    keccak256(
                        abi.encode(
                            CHANGE_VALIDATORS_TYPEHASH,
                            validators,
                            multisigThreshold
                        )
                    )
                )
            );

        validatorsApprove(msgHash, signatures, multisigThreshold_);

        validators_ = validators;
        multisigThreshold_ = multisigThreshold;
    }

    /**
     * @notice  if addr is not one of validators_, return validators_.length
     * @return  index of addr in validators_
     */
    function _getIndexOfValidators(address user)
        internal
        view
        returns (uint256)
    {
        for (uint256 i = 0; i < validators_.length; i++) {
            if (validators_[i] == user) {
                return i;
            }
        }
        return validators_.length;
    }

    /**
     * @notice             @dev signatures are a multiple of 65 bytes and are densely packed.
     * @param signatures   The signatures bytes array
     */
    function validatorsApprove(
        bytes32 msgHash,
        bytes memory signatures,
        uint256 threshold
    ) public view {
        require(signatures.length % SIGNATURE_SIZE == 0, "invalid signatures");

        // 1. check length of signature
        uint256 length = signatures.length / SIGNATURE_SIZE;
        require(
            length >= threshold,
            "length of signatures must greater than threshold"
        );

        // 3. check number of verified signatures >= threshold
        uint256 verifiedNum = 0;
        uint256 i = 0;

        uint8 v;
        bytes32 r;
        bytes32 s;
        address recoveredAddress;
        // set indexVisited[ index of recoveredAddress in validators_ ] = true
        bool[] memory validatorIndexVisited = new bool[](validators_.length);
        uint256 validatorIndex;
        while (i < length) {
            (v, r, s) = MultisigUtils.parseSignature(signatures, i);
            i++;

            recoveredAddress = ecrecover(msgHash, v, r, s);
            require(recoveredAddress != address(0), "invalid signature");

            // get index of recoveredAddress in validators_
            validatorIndex = _getIndexOfValidators(recoveredAddress);

            // recoveredAddress is not validator or has been visited
            if (
                validatorIndex >= validators_.length ||
                validatorIndexVisited[validatorIndex]
            ) {
                continue;
            }

            // recoveredAddress verified
            validatorIndexVisited[validatorIndex] = true;
            verifiedNum++;
            if (verifiedNum >= threshold) {
                return;
            }
        }
        require(verifiedNum >= threshold, "signatures not verified");
    }

    function unlock(UnlockRecord[] calldata records, bytes calldata signatures)
        public
    {
        // 1. calc msgHash
        bytes32 msgHash =
            keccak256(
                abi.encodePacked(
                    "\x19\x01", // solium-disable-line
                    _domainSeparator(),
                    keccak256(abi.encode(UNLOCK_TYPEHASH, records))
                )
            );

        validatorsApprove(msgHash, signatures, multisigThreshold_);

        for (uint256 i = 0; i < records.length; i++) {
            UnlockRecord calldata r = records[i];
            if (r.amount == 0) continue;
            if (r.token == address(0)) {
                payable(r.recipient).transfer(r.amount);
            } else {
                IERC20(r.token).safeTransfer(r.recipient, r.amount);
            }
            emit Unlocked(
                r.token,
                r.recipient,
                msg.sender,
                r.amount,
                r.ckbTxHash
            );
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
