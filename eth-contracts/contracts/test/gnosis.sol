// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.7.0 <0.9.0;

import { GnosisSafeProxyFactory } from "@gnosis.pm/safe-contracts/contracts/proxies/GnosisSafeProxyFactory.sol";
import { GnosisSafe } from "@gnosis.pm/safe-contracts/contracts/GnosisSafe.sol";
import { MultiSend } from "@gnosis.pm/safe-contracts/contracts/libraries/MultiSend.sol";

contract ProxyFactory_SV1_3_0 is GnosisSafeProxyFactory {}
contract GnosisSafe_SV1_3_0 is GnosisSafe {}
contract MultiSend_SV1_3_0 is MultiSend {}