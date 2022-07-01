//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title NervosMirrorNftToken - A token contract used for bridged nft token from Nervos Chain
contract NervosMirrorNftToken is ERC1155, Ownable{
    address public factory;
    string public classId;

    event CreatedNftToken(address tokenAddr, string classId, address factory);

    constructor(string memory uri_, string memory classId_) ERC1155(uri_) {
        factory = msg.sender;
        classId = classId_;
        emit CreatedNftToken(address(this), classId, factory);
    }

    function mint(address to, uint256 id, uint256 amount, bytes memory data) public onlyOwner {
        _mint(to, id, amount, data);
    }

    function mintBatch(address to, uint256[] memory ids, uint256[] memory amounts, bytes memory data) public onlyOwner {
        _mintBatch(to, ids, amounts, data);
    }

    function burn(address account, uint256 id, uint256 value) public onlyOwner {
        _burn(account, id, value);
    }
}
