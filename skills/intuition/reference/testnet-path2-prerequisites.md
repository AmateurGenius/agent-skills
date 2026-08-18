# Testnet Path 2 End-to-End Prerequisites

Last updated: 2026-08-17

## Funding Requirement

Before running Path 2 end-to-end on testnet, the **Main Account must hold enough tTRUST to fund three separate on-chain actions**:

1. Fund the new Smart Account EOA (recommended: 0.01–0.02 tTRUST)
2. Pay gas for the EIP-7702 upgrade tx on the Smart Account
3. Pay gas for the `approve(SmartAccount, approvalType)` tx from Main Account
4. Pay gas for the `redeemDelegations` tx from Smart Account
5. Pay gas for the `disableDelegation` tx from Main Account

**Minimum tested balance:** 0.02 tTRUST on the testnet Main Account.

## Pre-Flight Check

Run this before attempting any Path 2 testnet e2e:

```bash
cast balance *Address* --rpc-url https://testnet.rpc.intuition.systems/http
```

If balance < 200000000000000000 (0.2 tTRUST), bridge more tTRUST from mainnet or use a different funded testnet account.

## Known Blocker

Testnet Main Account `0x61A...Fa5ee` was observed at 0.00326 tTRUST on 2026-08-17. This is insufficient for the funding step alone (which requires ~0.01 tTRUST plus gas).

Resolution options:
- Bridge tTRUST via https://app.intuition.systems/bridge
- Use an alternative funded testnet account as the Main Account
- Proceed with mainnet Path 2 validation (already confirmed working)

## Approval Type Note

On testnet, `approvalType=3` (DEPOSIT | REDEMPTION) is the safe default. `approvalType=255` (APPROVE_ALL) reverts on mainnet and should be avoided in all documentation.
be avoided in all documentation.
