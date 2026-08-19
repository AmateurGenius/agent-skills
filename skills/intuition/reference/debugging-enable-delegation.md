# Debugging `enableDelegation` Reverts

## Symptom

`enableDelegation(delegation)` reverts with empty data (`require(false)` or bare `revert()`). No custom error message is returned.

## Diagnostic Steps

### 1. Verify Contract Responsiveness
```bash
cast call $DELEGATION_MANAGER "disabledDelegations(bytes32)(bool)" \
  0x0000000000000000000000000000000000000000000000000000000000000000 \
  --rpc-url $RPC
```
Must return `false`. If it reverts, the contract is not present or not reachable.

### 2. Verify Caller Matches Delegator
```bash
# The broadcaster address must exactly match delegation.delegator
DELEGATOR=$(cast wallet address --private-key $PRIVATE_KEY)
cast send --from $DELEGATOR --unlocked $DELEGATION_MANAGER \
  --data "$ENABLE_CALLDATA" --rpc-url $RPC
```

### 3. Verify Signature / Domain

**Read the domain separator from-chain. Do not reconstruct it from guessed
`name`/`version` literals.**

The contract recovers the signer from the delegation signature. Ensure:
- Domain name: `"DelegationManager"`
- Domain version: `"1"`
- Chain ID matches the target chain (testnet = 13579, NOT 1155)
- `verifyingContract` = `0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3`

Read the real domain separator:
```bash
cast call $DELEGATION_MANAGER "getDomainHash()(bytes32)" --rpc-url $RPC
```

Off-chain signing:
```js
// Read domainHash from-chain first, then use it directly in the signing digest
const domainHash = await client.readContract({
  address: DELEGATION_MANAGER,
  abi: parseAbi(['function getDomainHash() view returns (bytes32)']),
  functionName: 'getDomainHash',
});
const domain = { name: "DelegationManager", version: "1", chainId: 13579, verifyingContract: DELEGATION_MANAGER };
const types = { Delegation: [...], Caveat: [...] };
const sig = await wallet.signTypedData(domain, types, delegation);
```
### 4. Verify Struct Encoding
The on-chain `Delegation` struct is:
```solidity
struct Delegation {
  address delegator;
  address delegate;
  bytes32 authority;
  Caveat[] caveats;
  uint256 salt;
  bytes signature;
}
```
**NOT** `(address,address,bytes32,(address,bytes,bytes)[],bytes32,bytes,uint256)` — no `expiry` field.

Use ethers v6 to encode:
```js
const iface = new ethers.Interface([
  "function enableDelegation((address delegator,address delegate,bytes32 authority,(address enforcer,bytes terms,bytes args)[] caveats,uint256 salt,bytes signature) delegation) external"
]);
const calldata = iface.encodeFunctionData("enableDelegation", [delegation]);
```

### 5. Verify Calldata Selector
`enableDelegation` selector is `0x3ed01015` (flat tuple syntax).
```bash
cast sig "enableDelegation((address,address,bytes32,(address,bytes,bytes)[],uint256,bytes))"
# -> 0x3ed01015
```
Do NOT use nested parenthesized signatures with `cast sig`.

### 6. Check Salt Uniqueness
Each delegator must use a unique salt. Reusing a salt causes `require(false)`.

### 7. Check Delegation State
```bash
cast call $DELEGATION_MANAGER "disabledDelegations(bytes32)(bool)" $DELEGATION_HASH --rpc-url $RPC
# Must be false
```

### 8. Check Caveat Enforcers
Enforcer addresses must be contracts on the target chain:
- AllowedMethodsEnforcer: `0x2c21fD0Cb9DC8445CB3fb0DC5E7Bb0Aca01842B5`
- LimitedCallsEnforcer: `0x04658B29F6b82ed55274221a06Fc97D318E25416`

Verify with:
```bash
cast code $ENFORCER_ADDRESS --rpc-url $RPC | grep -q "0x" || echo "ENFORCER IS EOA"
```

### 9. Fork vs Live Chain
Anvil forks may have stale contract state. If all else fails, test on the live chain:
```bash
cast send $DELEGATION_MANAGER $ENABLE_CALLDATA \
  --private-key $PRIVATE_KEY \
  --rpc-url https://testnet.rpc.intuition.systems/http
```

### 10. EIP-7702 Authorization
If the contract requires EIP-7702 authorization, the delegator EOA must have:
```
slot 0: code address (non-zero)
slot 1: key address (non-zero)
```
Check:
```bash
cast storage $DELEGATOR 0 --rpc-url $RPC
cast storage $DELEGATOR 1 --rpc-url $RPC
```

**Note:** EIP-7702 authorization may succeed on mainnet (chain 1155) but `enableDelegation` can still revert with empty data. This indicates the off-chain signing script likely reconstructed the EIP-712 domain separator from guessed `name`/`version` literals instead of reading `getDomainHash()` first. The contract uses standard OpenZeppelin EIP-712 v4 encoding. See `references/e2e-test-findings.md` → Live Mainnet Revert Diagnostics.

### 11. ethers v6 Wallet Requirement
When using ethers v6 contract calls to send transactions, a provider-only wallet throws `UNSUPPORTED_OPERATION`. Use a signer:
```js
const wallet = new ethers.Wallet(privateKey, provider);
const dm = new ethers.Contract(address, abi, wallet);
const tx = await dm.enableDelegation(delegation);
```

## Known Issues on Forked Testnet
- `enableDelegation` and `getDelegationHash` may revert with empty data even with correct calldata.
- The contract bytecode on the fork may not contain the expected selectors.
- If debugging fails, proceed to live testnet before assuming the skill is wrong.
- On live mainnet, `enableDelegation` reverts with empty data even after successful EIP-7702 authorization. The root cause is likely a struct layout mismatch in the on-chain contract. See `references/e2e-test-findings.md`.
