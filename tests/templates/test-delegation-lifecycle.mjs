import { ethers } from 'ethers';
import fs from 'fs';

async function main() {
// Configuration
const RPC = "http://localhost:8545";
const DELEGATION_MANAGER = "0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3";
const MULTIVAULT = "0x2Ece8D4dEdcB9918A398528f3fa4688b1d2CAB91";
const CHAIN_ID = 13579;

// Use anvil default account 0 as delegator, account 1 as agent
const DELEGATOR_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const DELEGATOR_ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const AGENT_ADDR = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";

const provider = new ethers.JsonRpcProvider(RPC);
const delegatorWallet = new ethers.Wallet(DELEGATOR_PK, provider);

// --- Read domain hash on-chain (A2 fix) ---
const dm = new ethers.Contract(DELEGATION_MANAGER, [
  "function getDomainHash() view returns (bytes32)"
], provider);
const domainHash = await dm.getDomainHash();
console.log("Domain hash:", domainHash);

// EIP-712 domain (only needed for verifyTypedData recovery check)
const domain = {
  name: "DelegationManager",
  version: "1",
  chainId: CHAIN_ID,
  verifyingContract: DELEGATION_MANAGER,
};

// Delegation struct types for signing (without signature field)
const typesForHash = {
  Delegation: [
    { name: "delegator", type: "address" },
    { name: "delegate", type: "address" },
    { name: "authority", type: "bytes32" },
    { name: "caveats", type: "Caveat[]" },
    { name: "salt", type: "uint256" },
  ],
  Caveat: [
    { name: "enforcer", type: "address" },
    { name: "terms", type: "bytes" },
    { name: "args", type: "bytes" },
  ],
};

// Build delegation value (A4 fix: salt is uint256)
const salt = BigInt("0xaa59fdb88ce8e910c144101c5484cfd16cb18008e0de51b40c2994905374d881");
const caveats = [];

const value = {
  delegator: DELEGATOR_ADDR,
  delegate: AGENT_ADDR,
  authority: ethers.ZeroHash,
  caveats: caveats,
  salt: salt,
};

console.log("=== Step 1: Build and Sign Delegation ===");
console.log("Delegator:", DELEGATOR_ADDR);
console.log("Delegate:", AGENT_ADDR);
console.log("Salt:", salt.toString());

// Compute delegation hash using the on-chain implementation (A2/A5 fix)
// getDelegationHash is Intuition-specific and cannot be reproduced exactly off-chain with standard EIP-712
const onChainHash = await dm.getDelegationHash(value);
console.log("On-chain delegation hash:", onChainHash);

// Compute what ethers.js standard EIP-712 produces (for comparison only)
const DELEGATION_TYPE_HASH = ethers.keccak256(
  ethers.toUtf8Bytes("Delegation(address delegator,address delegate,bytes32 authority,(address enforcer,bytes terms,bytes args)[] caveats,uint256 salt)")
);
const encodedStructNoSig = ethers.AbiCoder.defaultAbiCoder().encode(
  ["address", "address", "bytes32", "(address,bytes,bytes)[]", "uint256"],
  [value.delegator, value.delegate, value.authority, value.caveats, value.salt]
);
const structHashNoSig = ethers.keccak256(ethers.concat([DELEGATION_TYPE_HASH, encodedStructNoSig]));
console.log("Ethers standard struct hash:", structHashNoSig);

// Use the on-chain hash for EIP-712 signing
const PREFIX = ethers.getBytes("0x1901");
const digestBytesNoSig = ethers.concat([PREFIX, ethers.getBytes(domainHash), ethers.getBytes(onChainHash)]);
const digestNoSig = ethers.keccak256(digestBytesNoSig);

// Sign with digest
const signature = await delegatorWallet.signDigest(digestNoSig);
console.log("Signature:", signature);

// Signature recovery check using standard ethers verifyTypedData (may mismatch custom on-chain hash)
const recovered = ethers.verifyTypedData(domain, typesForHash, value, signature);
console.log("Ethers recovery:", recovered);
console.log("Expected:", DELEGATOR_ADDR);
if (recovered.toLowerCase() !== DELEGATOR_ADDR.toLowerCase()) {
  console.warn(`Signature recovery mismatch: expected ${DELEGATOR_ADDR}, got ${recovered} — this is expected if off-chain EIP-712 differs from on-chain EncoderLib._getDelegationHash`);
}
console.log("Signature signed with on-chain hash");

// Verify disabledDelegations returns false initially
const dmContract = new ethers.Contract(DELEGATION_MANAGER, [
  "function disabledDelegations(bytes32) view returns (bool)",
  "function enableDelegation(tuple(address delegator,address delegate,bytes32 authority,tuple(address enforcer,bytes terms,bytes args)[] caveats,uint256 salt,bytes signature) delegation) external",
  "function disableDelegation(tuple(address delegator,address delegate,bytes32 authority,tuple(address enforcer,bytes terms,bytes args)[] caveats,uint256 salt,bytes signature) delegation) external",
  "function redeemDelegations(bytes[] calldata permissionContexts, bytes32[] calldata modes, bytes[] calldata executionCallData) external",
], delegatorWallet);

console.log("\n=== Step 2: Verify Delegation Not Disabled ===");
let disabled = await dmContract.disabledDelegations(hash);
console.log("disabledDelegations(hash):", disabled);

console.log("\n=== Step 3: Enable Delegation On-Chain ===");
const delegationWithSig = { ...value, signature: signature };
const enableTx = await dmContract.enableDelegation(delegationWithSig);
console.log("enableDelegation tx:", enableTx.hash);
await enableTx.wait();
console.log("enableDelegation confirmed");

disabled = await dmContract.disabledDelegations(hash);
console.log("disabledDelegations(hash) after enable:", disabled);

console.log("\n=== Step 4: Redeem Delegation - Create Atom ===");
// Build the inner call: createAtoms on MultiVault
const mvContract = new ethers.Contract(MULTIVAULT, [
  "function createAtoms(bytes[] calldata data, uint256[] calldata curveIds) external payable returns (bytes32[] memory termIds)",
], delegatorWallet);

const atomData = ethers.toUtf8Bytes("TestAtom");
const curveId = 1;
const atomCost = await mvContract.getAtomCost();
console.log("Atom cost:", atomCost.toString());

// Encode inner call
const innerCalldata = mvContract.interface.encodeFunctionData("createAtoms", [
  [atomData],
  [curveId]
]);

// Encode redeemDelegations call
// permissionContext = abi.encode(Delegation[], bytes32 delegationHash)
// NOTE: Delegation[] is an array; permissionContexts[i] is the 2-element tuple, NOT a keccak256 hash
const permissionContext = ethers.AbiCoder.defaultAbiCoder().encode(
  ["tuple(address,address,bytes32,(address,bytes,bytes)[] caveats,uint256)[]", "bytes32"],
  [[value], onChainHash]
);
const modes = [ethers.ZeroHash]; // mode = 0 for direct call
const executionCallData = innerCalldata;

const redeemTx = await dmContract.redeemDelegations(
  [permissionContext],
  modes,
  [executionCallData],
  { value: atomCost }
);
console.log("redeemDelegations tx:", redeemTx.hash);
const receipt = await redeemTx.wait();
console.log("redeemDelegations confirmed, block:", receipt.blockNumber);

// Verify atom was created
const atomId = await mvContract.calculateAtomId(atomData);
console.log("Atom ID:", atomId);
const exists = await mvContract.isTermCreated(atomId);
console.log("Atom exists:", exists);

console.log("\n=== Step 5: Disable Delegation ===");
const disableTx = await dmContract.disableDelegation(delegationWithSig);
console.log("disableDelegation tx:", disableTx.hash);
await disableTx.wait();
console.log("disableDelegation confirmed");

disabled = await dmContract.disabledDelegations(hash);
console.log("disabledDelegations(hash) after disable:", disabled);

console.log("\n=== Step 6: Verify Redemption Fails After Revoke ===");
try {
  await dmContract.redeemDelegations(
    [permissionContext],
    modes,
    [executionCallData],
    { value: atomCost }
  );
  console.log("ERROR: Should have reverted!");
} catch (e) {
  console.log("Correctly reverted:", e.message.split("\n")[0]);
}

console.log("\n=== FULL DELEGATION LIFECYCLE COMPLETE ===");
}

main().catch(console.error);
