//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./interfaces/IMirrorToken.sol";
import "./interfaces/IMirrorNftToken.sol";
import "./NervosMirrorNftToken.sol";

/// @title Asset Manager - The entry to manage all bridged tokens from Nervos chain
/// The owner of this contract should be transferred to the gnosis multi-sig wallet of Force Bridge committee when the
/// initializing is done.
/// All tokens recorded in this contract should be authorized to mint, and burn through this contract to make bridge action.
contract NftClassManager is Ownable, ReentrancyGuard {
  string private uri_ = "";

  struct ChainMetadata {
    uint8 chain; // 0: CKB
    uint8 chainId;
    uint8 nftType; // 1: mnft 2: nrc721 3: cota
    uint256 cellTxHash;
    uint32 cellIndex;
    bytes sourceOwner;
    string classId;
    address token;
  }

  // classId is the identifier of the nft class cell on Nervos Chain
  mapping(address => ChainMetadata) public tokenToChainMap;
  mapping(string => ChainMetadata) public classIdToChainMap;
  address[] public allTokens;

  event MintNft(
    string indexed classId,
    address indexed token,
    address indexed to,
    uint256 nftId,
    bytes lockId
  );

  event BurnNft(
    string indexed classId,
    address indexed token,
    address indexed from,
    uint256 nftId,
    uint256 fee,
    bytes recipient,
    bytes extraData
  );

  struct MintNftRecord {
    string classId; // nft class id locked on Nervos chain
    address to; // address of the receiver
    uint256 nftId; // nft id on Nervos chain
    bytes lockId; // used to identify the lock transaction on Nervos Chain
  }

  function createClass2(ChainMetadata memory chain) internal returns(address tokenAddr){
    tokenToChainMap[chain.token] = chain;
    classIdToChainMap[chain.classId] = chain;
    bytes32 salt = keccak256(abi.encodePacked(chain.classId));
    NervosMirrorNftToken nervosMirrorNftToken = new NervosMirrorNftToken{salt: salt}(uri_, chain.classId);
    tokenAddr = address(nervosMirrorNftToken);
    chain.token = tokenAddr;
    allTokens.push(tokenAddr);
    tokenToChainMap[tokenAddr] = chain;
    classIdToChainMap[chain.classId] = chain;
  }

  /// @dev Mint an nft.
  /// @param records The mint records.
  /// This function should only be invoked by the gnosis multi-sig wallet of Force Bridge committee.
  function mintNft(MintNftRecord[] memory records) public onlyOwner {
    for (uint256 i = 0; i < records.length; i++) {
      ChainMetadata memory chain = classIdToChainMap[records[i].classId];
      if (chain.token == address(0)) {
        chain.token = createClass2(chain);
      } else {
        chain.token = classIdToChainMap[chain.classId].token;
      }
      require(chain.token != address(0), "nft class not found");
      IMirrorNftToken(chain.token).mint(records[i].to, records[i].nftId, 1, "");
      emit MintNft(
        records[i].classId,
        chain.token,
        records[i].to,
        records[i].nftId,
        records[i].lockId
      );
    }
  }

  /// @dev Burn an nft and get the locked amount back on Nervos chain.
  /// @param token The address of the token to burn.
  /// @param nftId The nft id.
  /// @param recipient The recipient on Nervos Chain.
  /// @param extraData Extra data to be sent to the recipient.
  function burnNft(
    address token,
    uint256 nftId,
    bytes calldata recipient,
    bytes calldata extraData
  ) public payable nonReentrant {
    ChainMetadata memory chain = tokenToChainMap[token];
    require(chain.chainId != 0, "chain not supported");
    require(chain.token != address(0), "token not supported");
    // pay the fee to bridge committee
    if (msg.value > 0) {
      (bool success, ) = payable(owner()).call{value: msg.value}("");
      require(success, "fee payment to bridge committee failed");
    }
    // burn the nft
    IMirrorNftToken(token).burn(_msgSender(), nftId, 1);
    emit BurnNft(
      chain.classId,
      token,
      _msgSender(),
      nftId,
      msg.value,
      recipient,
      extraData
    );
  }
}
