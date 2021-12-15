//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./interfaces/IMirrorToken.sol";

contract AssetManager is Ownable, ReentrancyGuard {
    mapping(address => bytes32) public tokenToAssetIdMap;
    mapping(bytes32 => address) public assetIdToTokenMap;

    event Mint(bytes32 indexed assetId, address indexed token, address indexed to, uint256 amount, bytes lockId);

    event Burn(bytes32 indexed assetId, address indexed token, address indexed from, uint256 amount);

    struct MintRecord {
        bytes32 assetId;
        address to;
        uint256 amount;
        bytes lockId;       // lockId on Nervos chain
    }

    function addAsset(address token, bytes32 assetId) public onlyOwner {
        require(tokenToAssetIdMap[token] == 0x0);
        require(assetIdToTokenMap[assetId] == address(0));
        tokenToAssetIdMap[token] = assetId;
        assetIdToTokenMap[assetId] = token;
    }

    function removeAsset(address token, bytes32 assetId) public onlyOwner {
        require(tokenToAssetIdMap[token] == assetId);
        require(assetIdToTokenMap[assetId] == token);
        tokenToAssetIdMap[token] = 0x0;
        assetIdToTokenMap[assetId] = address(0);
    }

    function mint(MintRecord[] calldata records) public onlyOwner {
        for(uint i = 0; i < records.length; i++) {
            address tokenAddr = assetIdToTokenMap[records[i].assetId];
            require(tokenAddr != address(0), "Asset not found");
            IMirrorToken(tokenAddr).mint(records[i].to, records[i].amount);
            emit Mint(records[i].assetId, tokenAddr, records[i].to, records[i].amount, records[i].lockId);
        }
    }

    function burn(address token, uint256 amount) public nonReentrant {
        bytes32 assetId = tokenToAssetIdMap[token];
        require(assetId != 0x0, "token not supported");
        IMirrorToken(token).burn(_msgSender(), amount);
        emit Burn(assetId, token, _msgSender(), amount);
    }
}