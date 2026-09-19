# UX Patterns for Intuition Operations

> **Status:** MANDATORY — these patterns apply to every Intuition operation
> (read or write, any path). They prevent users from getting stuck,
> rebuilding already-completed steps, or missing documented requirements.

---

## 1. Pre-Task Context Check (MANDATORY)

Before executing ANY Intuition operation, run these checks **in order**:

### Step 1: Read Session Context

Check for setup notes, prior session state, and planned workflows:

- Read `reference/intuition-setup-notes.md` if it exists (session-specific constants, agent wallet, planned workflow)
- Use `session_search` to find prior Intuition work if no setup notes exist
- **Report what you found to the user BEFORE building anything**

### Step 2: Check Delegation State

For Path C operations, check if a valid delegation already exists:

- Read `~/.intuition/agent-state.json` and any `delegation-signed.json` files
- Check `disabledDelegations(hash)` on-chain for any cached delegation hashes
- **If a valid unexpired delegation exists, SKIP straight to execution** — do not ask the user to re-sign

### Step 3: State the Plan

Tell the user:
- What you found in prior session context (planned steps, addresses, constants)
- What's already done vs. what remains
- Which path (A/B/C) and why
- What you need from them (network choice, key for one-time signing, confirmation)

### Skipping these checks causes:
- Missing prior context
- Rebuilding already-completed steps
- Skipping documented requirements
- Asking the user to sign when a valid delegation already exists

---

## 2. Private Key Request Pattern (MANDATORY for Path C)

When Path C requires a new delegation, you **MUST** explicitly ask the user for their private key. Do not assume they know to provide it.

### Why Private Key Signing Is Recommended

MetaMask does **not** support the three alternative signing methods:

- **`personal_sign` / `eth_sign`** — MetaMask removed these. They also add an Ethereum prefix that breaks ERC-1271 validation.
- **`eth_signTypedData_v4`** — MetaMask blocks this for EIP-7702 upgraded accounts with: `External signature requests cannot sign delegations for internal accounts.`
- **`wallet_signTypedData_v4` (signing page)** — Works for non-EIP-7702 accounts via `templates/sign-delegation.html`, but fails for EIP-7702 delegators (the common case for the creation track).

**Private key signing (via local script or `cast`) is the only method that works in all cases** — EOA, EIP-7702, mainnet, testnet. It produces a standard EIP-712 signature with no prefix issues and no MetaMask restrictions.

### Delegation Re-Use After Setup

After the one-time signing, the delegation is **cached and re-used by the agent** for all subsequent operations until revoked. The user never needs to sign again unless:
- The delegation expires (if an expiry caveat was set)
- The delegation is revoked
- The operation scope changes (new methods, higher spend cap)

**Important:** the private key will be needed again whenever a **new delegation** must be created (revocation, expiry, or scope change). The cached delegation is re-used — it does not eliminate the key for future setup events.

### The Pattern

```
To set up the delegation, I need your Main Account private key for one-time off-chain signing.

Why: MetaMask blocks custom ERC-7702 signing, so local signing is the only method that works for all account types.

The key is used ONLY to sign the EIP-712 delegation digest — it is never stored, logged, or transmitted.
After setup, the delegation is cached and re-used for all future operations under this scope. You won't need to sign again — unless a new delegation is required (revocation, expiry, or scope change).

Paste your private key now (I'll use it in memory only, never write to disk):
```

### Rules

- **NEVER** proceed without explicitly asking for the key
- **NEVER** store the delegator's key to disk — use env vars or in-memory variables only
- **ALWAYS** explain what the key is used for (one-time EIP-712 signing) and that it won't be persisted
- **ALWAYS** state that the delegation is re-used after setup — the key is needed once, not per-operation
- After signing, the key goes "back in the vault" — **confirm this to the user**: `"Key used for signing. It is now back in the vault — not stored, not logged. Delegation cached for future operations. Note: a new key signing will be needed if this delegation is revoked, expires, or needs a scope change."`

---

## 3. Multi-Step Workflow Flagging (MANDATORY)

When the user asks for a single operation that is part of a documented multi-step workflow:

1. Identify the full workflow from setup notes or `reference/workflows.md`
2. Show the user where they are in the workflow
3. Flag any prerequisites that haven't been completed yet
4. Ask whether they want to do just this step or the full remaining workflow

### Example

```
This is step 3 of 5 in your planned workflow:

  ✅ 1. Create delegation (done)
  ✅ 2. Create atom (done)
  ⬜ 3. Deposit 2 TRUST into atom (what you're asking for)
  ⬜ 4. Create triple
  ⬜ 5. Deposit 2 TRUST into triple

Steps 4-5 are still pending. Do you want me to continue through the full remaining workflow after this step?
```

---

## 4. Network Selection (MANDATORY)

On first invocation (or when network is unknown), ask:

```
Which network?
1. Intuition Mainnet  -- chain 1155
2. Intuition Testnet  -- chain 13579
```

Do not assume the network. If the user previously selected a network in setup notes, confirm it's still correct before proceeding.

---

## 5. Output Before Action

Before emitting transaction calldata or signing requests, always show:

- **A summary of what will happen** — operations, costs, addresses
- **What the user needs to do next** — sign, broadcast, provide signatures
- **Any risks or irreversible actions** — delegation scope, spend caps, permanent revocation

### Example

```
SUMMARY:
  Operation: Deposit 2.0 tTRUST into atom 0xabcd...
  Vault: AtomVault (curveId: 1)
  Expected shares: ~18.5 shares (after fees)
  Delegation: Uses existing valid delegation (expires in 6h)

NEXT STEPS:
  1. I'll generate the redeemDelegations calldata
  2. Agent broadcasts from 0xe9Bf...050d
  3. Confirm result via post-write verification

RISKS:
  - Bonding curve slippage if vault state changed (will use minShares from preview)
  - Estimated entry fee: 2% (query previewDeposit for exact)

Proceed? (yes/no)
```

---

## 6. Common Roadblocks & Solutions (MANDATORY)

These issues were encountered during real validation of this skill. Check this section before debugging any failed operation.

### 6.1 Private Key Masking in Execution Environments

**Problem:** Some execution environments (Hermes, certain CI systems) mask private keys with `***` in output, logs, and sometimes in files. This causes "invalid BytesLike value" or "Failed to decode private key" errors.

**Solutions:**
- Pass private keys via environment variables at runtime: `PRIVATE_KEY="0x..." node script.js`
- Read private keys from files at runtime (write the file immediately before use, delete after)
- Never hardcode private keys in scripts that may be logged or stored
- Use `cast wallet import` to create a keystore file instead of raw private keys

### 6.2 Address Checksum Errors

**Problem:** ethers.js requires EIP-55 checksummed addresses. Using lowercase or incorrectly checksummed addresses causes "bad address checksum" errors.

**Solution:** Always use `ethers.getAddress(address)` to checksum addresses before use:
```javascript
const checksummed = ethers.getAddress('0x2c21fd0cb9dc8445cb3fb0dc5e7bb0aca01842b5');
// Returns: 0x2c21fD0Cb9DC8445CB3fb0DC5E7Bb0Aca01842B5
```

**Common addresses (pre-checksummed):**
- AllowedMethodsEnforcer: `0x2c21fD0Cb9DC8445CB3fb0DC5E7Bb0Aca01842B5`
- LimitedCallsEnforcer: `0x04658B29F6b82ed55274221a06Fc97D318E25416`
- NativeTokenTransferAmountEnforcer: `0xA9BC5458E3eD352Df2eA4AbE9e0bBA41173513B9`
- DelegationManager: `0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3`

### 6.3 `isApprovedFor` Not on Testnet

**Problem:** Calling `isApprovedFor(address,address)` on testnet MultiVault reverts with `require(false)` because the function doesn't exist on testnet.

**Solution:** On testnet, always call `approve(SmartWallet, 3)` directly without a pre-check. The call is idempotent — if approval already exists, it succeeds silently.

### 6.4 ROOT_AUTHORITY and MODE_DEFAULT Byte Length

**Problem:** `ROOT_AUTHORITY` and `MODE_DEFAULT` must be exactly 32 bytes (64 hex chars). Using a shorter or longer value causes silent reverts in `redeemDelegations`.

**Correct values:**
```javascript
const ROOT_AUTHORITY=*** + "f".repeat(64); // 0x + 64 Fs = 66 chars
const MODE_DEFAULT = "0x" + "0".repeat(64); // 0x + 64 zeros = 66 chars
```

**Verification:** Both values must have `.length === 66` (including `0x` prefix).

### 6.5 Array Length Mismatch in `createTriples`

**Problem:** `createTriples` takes 4 parallel arrays: `subjectIds[]`, `predicateIds[]`, `objectIds[]`, `assets[]`. All must have the same length. A mismatch causes `MultiVault_ArraysNotSameLength`.

**Solution:** Always verify array lengths match before calling:
```javascript
if (subjectIds.length !== predicateIds.length || 
    subjectIds.length !== objectIds.length || 
    subjectIds.length !== assets.length) {
  throw new Error('Array length mismatch');
}
```

### 6.6 Different Costs for Atoms vs Triples

**Problem:** `getAtomCost()` and `getTripleCost()` return different values. Using the wrong cost causes `MultiVault_InsufficientBalance`.

**Solution:** Always query the correct cost function for the operation:
```javascript
const atomCost = await provider.call(MULTIVAULT, "getAtomCost()(uint256)");
const tripleCost = await provider.call(MULTIVAULT, "getTripleCost()(uint256)");
```

**Typical values (query on-chain to confirm):**
- Atom cost: ~1.000000001 tTRUST
- Triple cost: ~1.000000002 tTRUST

### 6.7 `enableDelegation` Is Optional

**Problem:** Calling `enableDelegation` is NOT required for the standard signature-based flow. It's an optional caching alternative.

**Solution:** Skip `enableDelegation` entirely. The delegation is validated by signature at redemption time.

### 6.8 EIP-7702 Upgrade Commands

**Problem:** Upgrading a wallet to EIP-7702 requires the implementation address directly, NOT the `0xef0100...` prefix.

**Correct command:**
```bash
cast send $OWS_ADDRESS --auth $EIP7702_IMPLEMENTATION --private-key $OWS_PK
```

**Verification:**
```bash
cast code $OWS_ADDRESS
# Should return: 0xef0100<implementation-address>
```

### 6.9 Funding Requirements for OWS

**Problem:** The OWS needs sufficient tTRUST for both creation costs AND gas. Running out of tTRUST causes reverts mid-operation.

**Funding guidelines:**
- Per atom creation: ~1 tTRUST (creation cost) + gas
- Per triple creation: ~1 tTRUST (creation cost) + gas
- Per deposit: deposit amount + gas
- Recommended minimum: 2-3 tTRUST for a full creation session

### 6.10 Revocation vs Expiry

**Problem:** Revoked delegations cannot be re-enabled. They are permanently dead.

**Solution:** Use expiry caveats instead of revocation when possible. If revocation is needed, create a new delegation with a new salt afterward.

### 6.11 Triple Already Exists

**Problem:** `createTriples` reverts with `MultiVault_TripleExists` if the triple already exists (same subject+predicate+object combination).

**Solution:** Check existence before creating:
```javascript
const tripleId = await provider.call(MULTIVAULT, "calculateTripleId(bytes32,bytes32,bytes32)...", [s, p, o]);
const exists = await provider.call(MULTIVAULT, "isTermCreated(bytes32)...", [tripleId]);
if (exists) {
  // Triple already exists, use existing ID
}
```

### 6.12 `execCallData` Encoding

**Problem:** `execCallData` must use `solidityPacked(['address','uint256','bytes'], ...)`, NOT `abi.encode`. Using `abi.encode` places the inner calldata at byte 0x80+ where `decodeSingle` reads garbage, causing `method-not-allowed` errors even with correct caveat terms.

**Correct encoding:**
```javascript
const execCallData = ethers.solidityPacked(
  ['address', 'uint256', 'bytes'],
  [MULTIVAULT, value, innerCalldata]
);
```

### 6.13 `disableDelegation` Field Order

**Problem:** `disableDelegation` uses the standard MetaMask struct field order `(delegate, delegator, ...)`. Using reversed order causes `InvalidDelegator()`.

**Correct order:**
```javascript
// disableDelegation takes: (delegate, delegator, authority, caveats, salt, signature)
const calldata = iface.encodeFunctionData("disableDelegation", [[
  delegation.delegate,    // FIRST
  delegation.delegator,   // SECOND
  delegation.authority,
  delegation.caveats,
  BigInt(delegation.salt),
  delegation.signature
]]);
```

---

## 7. Pre-Flight Checklist (Before Every Delegated Write)

1. ✓ Network selected (mainnet 1155 / testnet 13579)
2. ✓ Domain hash read from-chain via `getDomainHash()`
3. ✓ Delegation signature verified (recovered address === delegator)
4. ✓ `ROOT_AUTHORITY` is exactly 66 chars (0x + 64 Fs)
5. ✓ `MODE_DEFAULT` is exactly 66 chars (0x + 64 zeros)
6. ✓ Array lengths match (for batch/triple operations)
7. ✓ Correct cost queried (`getAtomCost` vs `getTripleCost`)
8. ✓ Sufficient tTRUST balance for operation + gas
9. ✓ `execCallData` uses `solidityPacked` (not `abi.encode`)
10. ✓ Caveat terms use correct encoding (raw bytes4 for methods, `abi.encode(uint256)` for limits)
