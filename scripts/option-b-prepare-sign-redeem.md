# Option B: prepare → sign → redeem

Three-script flow that avoids MetaMask browser signing by separating keyless
preparation from local signing.

## Scripts

| Script | Key required | Purpose |
|--------|-------------|---------|
| `prepare-option-b.mjs` | None | Reads on-chain `getDomainHash()`, builds delegation struct, computes `getDelegationHash()` on-chain, encodes operations, writes `option-b-prepared.json` |
| `sign-option-b.mjs` | `MAIN_ACCOUNT_PK` (local only) | Reads `option-b-prepared.json`, signs EIP-712 digest with Main Account key, writes `option-b-signed.json` |
|| `redeem-option-b.mjs` | Agent key | Reads `option-b-signed.json`, builds `redeemDelegations` calldata, broadcasts from Agent address |

## UX preference

Prepare the signing output ahead of time. The user should only need to run
`sign-option-b.mjs` once locally with their Main Account private key. The
resulting `option-b-signed.json` can be stored and reused for future
redelegations or passed directly to `redeem-option-b.mjs`.

## Verified addresses (mainnet chain 1155)

```
DELEGATION_MANAGER = 0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3
MULTIVAULT         = 0x6E35cF57A41fA15eA0EaE9C33e751b01A784Fe7e
ALLOWED_METHODS_ENFORCER = 0x2c21fD0Cb9DC8445CB3fb0DC5E7Bb0Aca01842B5
LIMITED_CALLS_ENFORCER   = 0x04658B29F6b82ed55274221a06Fc97D318E25416
NATIVE_TOKEN_ENFORCER=0xa9bc...
```

## Role selectors (OpenZeppelin AccessControl)

```
approve      0x4342e966
grantRole    0x2f2ff15d
hasRole      0x91d14854
revokeRole   0xd547741f
renounceRole 0x36568abe
```

`authorize` does NOT exist on MultiVault.

## Key rules

- `getDomainHash()` must be read on-chain. Use its returned `bytes32` directly.
- `getDelegationHash()` must be read on-chain. Use its returned `bytes32` directly.
- `_permissionContexts[i]` = `abi.encode(Delegation[])`. The contract decodes it with `abi.decode(_permissionContexts[batchIndex_], (Delegation[]))`. Do NOT wrap in a 2-element tuple with `bytes32 delegationHash`; that causes a decode mismatch.
- `_permissionContexts` array length MUST equal `_modes` and `_executionCallData` array lengths. One context per operation. Each context is `abi.encode(Delegation[])` — a flat array, not a tuple.
- `execCallData` = `ethers.solidityPacked(["address","uint256","bytes"], [target, value, innerCalldata])`. NOT `AbiCoder.defaultAbiCoder().encode` — ABI encoding places inner calldata at byte 0x80+, but the `decodeSingle()` reads from byte 0x34, causing `method-not-allowed` (0x08c379a0).
- EIP-712 digest = `ethers.keccak256(ethers.concat([ethers.getBytes("0x1901"), ethers.getBytes(domainHash), ethers.getBytes(structHash)]))`. NOT `solidityPackedKeccak256`.
- Inner `value` must exactly equal `sum(assets[])`.
- Outer `redeemDelegations` carries `value = 0`.
- `callLimit` should cover total expected `redeemDelegations` transactions, not inner ops.
- Prefer a single reusable delegation covering all intended operations.

## Pitfalls

- `NATIVE_TOKEN_ENFORCER` checksum: use `0xa9bc...` (lowercase). `0xA9...` causes `TypeError: bad address checksum` in ethers v6.
- `cast send $SMART "0x" --auth $IMPL` expects the **implementation address directly**, NOT `0xef0100...`.
- EIP-7702 upgrade is reversible: send to self with `0xef` prefix + implementation address.
- **Mainnet EntryPoint blocker (2026-08-28):** `redeemDelegations` reverts with `require(false)` during gas estimation when the delegation chain root is an EIP-7702 upgraded Main Account pointing to EntryPoint `0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B`. The DelegationManager calls `executeFromExecutor` on the root authority's proxy, but the live EntryPoint implementation reverts with selector `0x1a4b3a04` when invoked by the DelegationManager. This means the creation track (`redeemDelegations` with Main Account as root) is currently blocked on mainnet for this EntryPoint implementation. Workaround: use the deposit track (Smart Wallet + MultiVault `approve`) where the Agent executes via Smart Wallet delegation, or use an OWS as intermediate delegator.
- `sign-option-b.mjs` may fail with exit 1 if `MAIN_ACCOUNT_PK` is incorrect or if the EIP-712 digest computation differs from on-chain. Verify the digest by recovering the address from the signature: `ethers.verifyTypedData(domain, types, value, signature)` should return the Main Account.
