//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title NervosMirrorToken - A token contract used for bridged token from Nervos Chain
contract NervosMirrorToken is ERC20, Ownable {
    uint8 private _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    function mint(address user, uint256 amount) public onlyOwner {
        _mint(user, amount);
    }

    function burn(address user, uint256 amount) public onlyOwner {
        _burn(user, amount);
    }
}
