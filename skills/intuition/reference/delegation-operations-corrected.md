# Delegation Operations — Corrected Reference

This file documents the verified corrections to delegation operation flows
discovered during Mission 12 fix-and-verify pass. It supersedes any
conflicting guidance in `operations/create-delegation.md` and
`operations/revoke-delegation.md` until those files are updated.

---

## Salt Type

`salt` is **`uint256`**, not `bytes32`. Every ABI definition, type definition,
and example must use `uint256`.

```typescript
// Correct
{ name: 'salt', type: 'uint256' }
salt: BigInt('0x' + randomBytes(32).toString('hex'))

// Wrong
{ name: 'salt', type: 'bytes32' }
salt: '0x' + randomBytes(32).toString('hex')
```

---

## Domain Separator

Always read the domain separator from-chain via `getDomainHash()` (selector
`0x83ebb771`). Never reconstruct it from guessed `name`/`version` literals.

```bash
cast call $DELEGATION_MANAGER "getDomainHash()(bytes32)" --rpc-url $RPC
```

Use the returned `bytes32` directly in the signing digest:
`keccak256("\x19\x01" ++ domainSeparator ++ structHash)`.

Common pitfall: using the `EIP7702StatelessDeleGator` contract's domain
constants (`name="EIP7702StatelessDeleGator"`, `version="1"`) instead of the
DelegationManager's.

---

## EIP-712 Struct Hash

The DelegationManager implements **standard OpenZeppelin EIP-712 v4** struct
hashing. The confirmed type strings are:

```
Delegation(address delegator, address delegate, bytes32 authority, Caveat[] caveats, uint256 salt)
Caveat(address enforcer, bytes terms, bytes args)
```

`salt` is excluded from each caveat's hash. `args` is excluded from each
caveat's hash. `signature` is excluded from the delegation hash.

The `Caveat[]` array is hashed per EIP-712's array rule:
`keccak256(concat(hashStruct(caveats[0]), hashStruct(caveats[1]), ...))`
— NOT raw-encoded as a tuple array.

Pass the domain, types, and message directly to the library's typed-data
signing function. Do not hand-roll `abi.encode` for this step.

---

## Mandatory Verification Gates

### Gate 1: Off-chain struct hash matches on-chain `getDelegationHash()`

Before signing, compute the delegation hash off-chain and compare it against
`getDelegationHash()` called on-chain. They must match exactly.

```typescript
// Off-chain (standard EIP-712)
const structHash = hashTypedData({ domain, types, primaryType: 'Delegation', message: delegationWithoutSignature })

// On-chain
const onChainHash = await client.readContract({
  address: DELEGATION_MANAGER,
  abi: parseAbi(['function getDelegationHash((address delegator,address delegate,bytes32 authority,(address enforcer,bytes terms,bytes args)[] caveats,uint256 salt,bytes signature) delegation) view returns (bytes32)']),
  functionName: 'getDelegationHash',
  args: [fullDelegationWithSignaturePlaceholder],
})

if (structHash !== onChainHash) {
  throw new Error('hash_mismatch: off-chain struct hash does not match on-chain getDelegationHash')
}
```

If they don't match, the bug is in the off-chain struct-hash implementation
specifically (most likely: array hashing done as raw `abi.encode` instead of
per-element `hashStruct`). Fix that before touching anything else.

### Gate 2: Pre-broadcast signature recovery

After signing, recover the signer from `digest` + signature and confirm it
equals `delegation.delegator` byte-for-byte.

```typescript
import { recoverTypedDataAddress } from 'viem'

const recovered = await recoverTypedDataAddress({
  domain,
  types,
  primaryType: 'Delegation',
  message: delegationWithoutSignature,
  signature: delegation.signature,
})

if (recovered.toLowerCase() !== delegation.delegator.toLowerCase()) {
  throw new Error('signature_invalid: recovered address does not match delegator')
}
```

Confirm the final byte of the 65-byte signature decodes to `0x1b` or `0x1c`
(27/28). If the signing library exposes a separate `yParity` (0/1) field, do
not use it as `v` directly; use the library's fully-assembled signature output,
or normalize explicitly (`v < 27 ? v + 27 : v`) and re-verify recovery after
normalizing.

---

## Permission Context

`_permissionContexts[i]` must equal the `bytes32` returned by
`getDelegationHash(delegation)` called on-chain. Do not compute this hash
off-chain with standard ABI encoding.

```bash
# Correct: read from-chain
cast call $DELEGATION_MANAGER "getDelegationHash((...))(bytes32)" "..." --rpc-url $RPC
```

---

## Revocation Propagation

Revocation is not a separate propagation mechanism. `redeemDelegations`
validates every delegation hash in the presented chain, leaf to root. If a
root delegation is disabled, any redemption presenting a chain through that
root fails at the chain-validation check. "Revoking root kills all downstream"
is a direct consequence of this, not a distinct feature to locate elsewhere in
the contract.

---

## enableDelegation

`enableDelegation` is **optional**, not mandatory. For the standard
signature-based flow (delegator signs off-chain, Agent calls
`redeemDelegations`), `enableDelegation` is not required. It is an optional
caching alternative for delegators who do not want to provide an EIP-712
signature.

---

## Parent Hash for Redelegation

When creating a redelegation, read the parent delegation hash from-chain via
`getDelegationHash()` on the DelegationManager. Set `AUTHORITY` to that hash.

Do not compute the parent hash off-chain with `keccak256(abi.encode(...))`.

---

## Delegator Account Type and Signing

- **Plain EOA (no code):** sign the digest directly with raw ECDSA. Do NOT
  use `personal_sign`/`eth_sign`-style message signing
  (`ethers.Wallet.signMessage()` prepends `\x19Ethereum Signed Message:\n32`,
  which is a different scheme entirely).
- **EIP-7702-upgraded or separate smart contract account:** The
  DelegationManager routes to `IERC1271(delegator).isValidSignature(digest,
  signature)`. Confirm what signature format the specific `IERC1271`
  implementation expects — for `EIP7702StatelessDeleGator`, this is very
  likely still a standard 65-byte ECDSA signature over the same digest, but
  confirm against the actual implementation source before assuming.
