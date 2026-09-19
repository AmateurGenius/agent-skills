# Deposit/Redemption Authority Track

Documents the Smart Wallet + `approve` track for `deposit`, `redeem`, and batch operations.

## Architecture

```
Main Account --(approve)--> Smart Wallet (on MultiVault)
Smart Wallet --(EIP-712 delegation)--> Agent
```

The Smart Wallet is the on-chain actor for deposit/redemption. It holds the
`approve` from Main Account. The Smart Wallet is a Main Account-derived
contract (CREATE2 or EIP-7702) — the Agent never holds its private key. The
Agent broadcasts `redeemDelegations` using the delegation signed by the Main
Account (as Smart Wallet owner).

## Setup (one-time)

### Step 1: Main Account approves Smart Wallet

```bash
cast send $MULTIVAULT "approve(address,uint8)" $SMART_WALLET 3 \
  --from $MAIN_ACCOUNT \
  --rpc-url $RPC
```

`approvalType = 3` (DEPOSIT | REDEMPTION). This is standing until revoked.

> **Pitfall:** `approvalType = 255` (APPROVE_ALL) reverts on mainnet. Use `3`.
> **Pitfall:** `isApprovedFor(address,address)` exists on mainnet but NOT on testnet.

### Step 2: Optional — Fund Smart Wallet via ERC-7715 stream

From MetaMask UI: `wallet_requestExecutionPermissions` with type
`native-token-periodic`. Parameters: `amountPerPeriod`, `periodDuration`, `expiry`.

This is optional — the Smart Wallet can also be funded via direct transfer.

### Step 3: Main Account (as Smart Wallet owner) signs delegation to Agent

```javascript
// Set DELEGATOR = Smart Wallet address
// Main Account signs EIP-712 delegation off-chain (as Smart Wallet contract owner)
// Cached for repeated use
```

## Agent Execution

### Single deposit

```javascript
redeemDelegations(
  permissionContexts: [abi.encode([smartWalletToAgentDelegation])],
  modes: [MODE_SINGLE_DEFAULT],
  executionCallData: [
    AbiCoder.encode(
      ["address", "uint256", "bytes"],
      [MULTIVAULT, depositAmount, depositCalldata(receiver: MainAccount, ...)]
    )
  ]
)
```

Key: `receiver` in the inner calldata MUST be the Main Account address.

### Batch deposit

```javascript
// Same pattern, but with depositBatch calldata
// receiver is the first arg of depositBatch
```

## Revocation

The Main Account can kill deposit authority two ways:

1. **Revoke delegation:** Call `disableDelegation(smartWalletToAgentDelegation)`
2. **Remove approve:** Call `approve(SmartWallet, 0)` on MultiVault (sets approval to none)

Either is sufficient. Both together = full kill.

## Attribution

- `msg.sender` at MultiVault = Smart Wallet
- `receiver` = Main Account (explicit in calldata)
- Shares minted to `receiver`, not `msg.sender`
- Main Account is the beneficial owner

**Live proof (2026-08-31):** Smart Wallet `0x4C6e...2AaA` deposited to Main Account `0xf500...6a19` on mainnet. Shares minted to receiver.

## Error Patterns

| Error | Cause | Fix |
|---|---|---|
| `MultiVault_Unauthorized` | Smart Wallet lacks `approve` | Main Account must call `approve(SmartWallet, 3)` |
| `MultiVault_CannotApproveOrRevokeSelf` | Attempted approve with receiver == sender | Don't call approve from Smart Wallet |
| `receiver_mismatch` | Receiver != Main Account | Fix receiver in calldata |

## See Also

- `reference/unified-delegation-architecture.md` — Full two-track model
- `reference/delegation.md` — Core concepts and signing flow
- `reference/creation-authority-track.md` — OWS-based creation (direct, no chain)
- `operations/approve.md` — Approve encoding details
