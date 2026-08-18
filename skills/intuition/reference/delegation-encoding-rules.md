# Delegation Encoding Rules

Network-agnostic encoding rules verified on testnet and mainnet. These rules apply to all networks.

## `_permissionContexts` is a 2-element tuple
`abi.encode(Delegation[], bytes32 delegationHash)`. NOT just `Delegation[]` or just the hash alone.

## `executionCallData` must be `solidityPacked`
Use `ethers.solidityPacked(["address","uint256","bytes"], [target, value, innerCalldata])`. NOT `abi.encode((address,uint256,bytes))` — tuple adds offset pointer.

## AllowedMethodsEnforcer terms
Raw concatenated `bytes4` selectors: `"0x61403309"`. NOT ABI-encoded `bytes4[]` array.

## LimitedCallsEnforcer terms
`abi.encode(uint256)` e.g. `abi.encode([5])`. NOT raw bytes.

## Authority
Must equal on-chain `ROOT_AUTHORITY` (`0xffff...ffff`). Never `0x0`.

## `DELEGATE` must equal `msg.sender` for EOA broadcasts
If `delegate != msg.sender && delegate != ANY_DELEGATE` => `InvalidDelegate()`

## `getDelegationHash()` on-chain
Pin domain hash from `getDomainHash()`. Verify delegation hash matches on-chain before broadcasting.

## Keccak-256 for selectors
`ethers.id()` gives Keccak-256. Node `crypto.sha3-256` gives NIST SHA3-256 which is wrong.

## cast call simulation
Reveals exact error selectors without burning gas:
- 0xb5863604 = InvalidDelegate()
- 0xb4856ebc = MultiVault_AtomExists
- 0x05baa052 = CannotUseADisabledDelegation()

## Kill switch proof
1. Write: 0x0191... block 9365664
2. Revoke: 0xbabc... block 9365665
3. Blocked: revert 0x05baa052

## Verified testnet addresses
DELEGATION_MANAGER = 0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3
MULTIVAULT = 0x2Ece8D4dEdcB9918A398528f3fa4688b1d2CAB91
ALLOWED_METHODS_ENFORCER = 0x2c21fD0Cb9DC8445CB3fb0DC5E7Bb0Aca01842B5
LIMITED_CALLS_ENFORCER = 0x04658B29F6b82ed55274221a06Fc97D318E25416

## Verified addresses
```
DELEGATION_MANAGER = 0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3
MULTIVAULT_TESTNET = 0x2Ece8D4dEdcB9918A398528f3fa4688b1d2CAB91
MULTIVAULT_MAINNET = 0x6E35cF57A41fA15eA0EaE9C33e751b01A784Fe7e
ALLOWED_METHODS_ENFORCER = 0x2c21fD0Cb9DC8445CB3fb0DC5E7Bb0Aca01842B5
LIMITED_CALLS_ENFORCER = 0x04658B29F6b82ed55274221a06Fc97D318E25416
```

## Layer 1: Isolated ERC-1271 Probe
Before wrapping anything in `redeemDelegations`, call `isValidSignature(digest, signature)`
directly on the delegator contract with the exact digest and signature you plan to use.

Pass condition: Returns `0x1626ba7e...` (ERC1271_MAGIC_VALUE, left-padded to 32 bytes).

Verified on-chain:
- Testnet upgraded account `0x61A...Fa5ee`: `0x1626ba7e...`
- Mainnet same address: `0x1626ba7e...`

## Layer 2: Domain Hash From-Chain
Call `getDomainHash()` on the DelegationManager and use the returned `bytes32` directly
in the EIP-712 digest: `keccak256("\x19\x01" ++ domainHash ++ structHash)`.

Pass condition: Domain hash matches on-chain read.
On mainnet: It no longer reverts — current RPC returns `0x44653bfc...`.

## Layer 3: Struct Hash Verified On-Chain
Compute `getDelegationHash()` off-chain, then call `getDelegationHash(delegation)` on-chain
with the full struct (including a placeholder signature). Compare.

Pass condition: `offChainHash === onChainHash`.
If mismatch: Fix caveats array hashing (per-element `hashStruct`, then concatenate with `abi.encodePacked`, then `keccak256`).

## Layer 4: Signature Recovery Gate
After signing the digest, run `ethers.recoverAddress(digest, signature)` and verify it equals
`delegator` byte-for-byte.

Pass condition: `recovered.toLowerCase() === DELEGATOR.toLowerCase()`.

## Layer 5: Exact Encoding Rules
These are the non-negotiable encodings that must be applied **in this order** when building `redeemDelegations` calldata:

1. **`_permissionContexts[i]`** = `abi.encode(Delegation[], bytes32 delegationHash)` — Two-element tuple.
2. **`execCallData`** = `ethers.solidityPacked(["address","uint256","bytes"], [MULTIVAULT, value, innerCalldata])` — Flat packed.
3. **`AllowedMethodsEnforcer` terms** = raw concatenated `bytes4` selectors: `"0x61403309"`.
4. **`LimitedCallsEnforcer` terms** = `abi.encode(uint256)`, e.g., `abi.encode([5])`.
5. **Caveat `args`** = `"0x"` (empty bytes).
6. **`salt`** = `uint256`, not `bytes32`.
7. **`DELEGATE`** = `DELEGATOR` for EOA broadcasts.

## Layer 6: Pre-Compute Atom ID via Read-Only Call
Call `createAtoms` via `provider.call({ to: MULTIVAULT, data: atomIdCalldata, value: atomCost, from: DELEGATOR })`
before broadcasting to get the deterministic atom ID.

Why it mattered: On mainnet, a value-bearing `eth_call` without a `from` address reverts with
"insufficient funds" because the EVM tries to debit value from `address(0)`. Specifying `from: DELEGATOR` fixes this.

## Layer 7: Systematic Debugging Order
When `redeemDelegations` fails, rule out causes in this exact order:

1. `_permissionContexts` missing the `delegationHash` tuple element
2. `execCallData` uses `abi.encode(tuple)` instead of `solidityPacked`
3. `AllowedMethodsEnforcer` terms are ABI-encoded `bytes4[]` instead of raw bytes4
4. `LimitedCallsEnforcer` terms are raw bytes instead of `abi.encode(uint256)`
5. Inner execution `value` ≠ `sum(assets[])`
6. Delegator balance insufficient for inner value
7. Bare direct call from delegator also fails → bug is in inner operation
8. `isTermCreated` for atom data returns `true` → atom already exists

## Kill switch proof
1. Write: `0x0191...` block 9365664
2. Revoke: `0xbabc...` block 9365665
3. Blocked: revert `0x05baa052`

## Atom data
CAIP-10: `caip10:eip155:1155:0x4140Fad2e771fE395a71dA3E2B63236B5f5694C4`

## Atom data
CAIP-10: caip10:eip155:1155:0x4140Fad2e771fE395a71dA3E2B63236B5f5694C4

## Debugging order (legacy shorthand)
1. Fix getDelegationHash() mismatch
2. Fix execCallData packing
3. Fix terms format per enforcer
4. Re-add caveats one by-one
5. Check isTermCreated()
6. Use cast call simulation
