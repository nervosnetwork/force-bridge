// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IMirrorNftToken {
    function mint(address to, uint256 id, uint256 amount, bytes memory data) external;

    function mintBatch(address to, uint256[] memory ids, uint256[] memory amounts, bytes memory data) external;

    function burn(address account, uint256 id, uint256 value) external;
}
