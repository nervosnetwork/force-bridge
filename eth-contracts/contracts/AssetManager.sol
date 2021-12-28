//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/security/ReentrancyGuard.sol';
import './interfaces/IMirrorToken.sol';

/// @title Asset Manager - The entry to manage all bridged tokens from Nervos chain
/// The owner of this contract should be transferred to the gnosis multi-sig wallet of Force Bridge committee when the
/// initializing is done.
/// All tokens recorded in this contract should be authorized to mint, and burn through this contract to make bridge action.
contract AssetManager is Ownable, ReentrancyGuard {
  // Mapping to keep track of the mirror tokens
  // token is the address of the mirror token on Ethereum
  // assetId is the identifier of the asset on Nervos Chain
  mapping(address => bytes32) public tokenToAssetIdMap;
  mapping(bytes32 => address) public assetIdToTokenMap;

  event Mint(
    bytes32 indexed assetId,
    address indexed token,
    address indexed to,
    uint256 amount,
    bytes lockId
  );

  event Burn(
    bytes32 indexed assetId,
    address indexed token,
    address indexed from,
    uint256 amount,
    uint256 fee,
    bytes recipient,
    bytes extraData
  );

  struct MintRecord {
    bytes32 assetId; // asset id locked on Nervos chain
    address to; // address of the receiver
    uint256 amount; // locked amount on Nervos chain
    bytes lockId; // used to identify the lock transaction on Nervos Chain
  }

  /// @dev Add a new asset to the asset manager.
  function addAsset(address token, bytes32 assetId) public onlyOwner {
    require(tokenToAssetIdMap[token] == 0x0);
    require(assetIdToTokenMap[assetId] == address(0));
    tokenToAssetIdMap[token] = assetId;
    assetIdToTokenMap[assetId] = token;
  }

  /// @dev Remove an asset from the asset manager.
  function removeAsset(address token, bytes32 assetId) public onlyOwner {
    require(tokenToAssetIdMap[token] == assetId);
    require(assetIdToTokenMap[assetId] == token);
    tokenToAssetIdMap[token] = 0x0;
    assetIdToTokenMap[assetId] = address(0);
  }

  /// @dev Mint an asset.
  /// @param records The mint records.
  /// This function should only be invoked by the gnosis multi-sig wallet of Force Bridge committee.
  function mint(MintRecord[] calldata records) public onlyOwner {
    for (uint256 i = 0; i < records.length; i++) {
      address tokenAddr = assetIdToTokenMap[records[i].assetId];
      require(tokenAddr != address(0), 'Asset not found');
      IMirrorToken(tokenAddr).mint(records[i].to, records[i].amount);
      emit Mint(
        records[i].assetId,
        tokenAddr,
        records[i].to,
        records[i].amount,
        records[i].lockId
      );
    }
  }

  /// @dev Burn an asset and get the locked amount back on Nervos chain.
  /// @param token The address of the token to burn.
  /// @param amount The amount to burn.
  /// @param recipient The recipient on Nervos Chain.
  /// @param extraData Extra data to be sent to the recipient.
  function burn(
    address token,
    uint256 amount,
    bytes calldata recipient,
    bytes calldata extraData
  ) public payable nonReentrant {
    bytes32 assetId = tokenToAssetIdMap[token];
    require(assetId != 0x0, 'token not supported');
    // pay the fee to bridge committee
    if (msg.value > 0) {
      (bool success, ) = payable(owner()).call{value: msg.value}('');
      require(success, 'fee payment to bridge committee failed');
    }
    // burn the asset
    IMirrorToken(token).burn(_msgSender(), amount);
    emit Burn(
      assetId,
      token,
      _msgSender(),
      amount,
      msg.value,
      recipient,
      extraData
    );
  }
}
