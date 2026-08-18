#!/usr/bin/env node
import \"dotenv/config\";
import { ethers } from \"ethers\";

// === Intuition Delegation Lifecycle ===
// Path: Separate Smart Account OR EIP-7702 Direct.
// Tests: create delegation → write via delegation → revoke → confirm blocked.
//
// Required env:
//   DELEGATOR_PRIVATE_KEY
//   DELEGATOR_ADDRESS
//   AGENT_PRIVATE_KEY
//   AGENT_ADDRESS
//   RPC  (default testnet)
//   CHAIN_ID  (default 13579)
//   MULTIVAULT
//   DELEGATION_MANAGER
//
// Usage:
//   DELEGATOR_PRIVATE_KEY=... DELEGATOR_ADDRESS=... AGENT_PRIVATE_KEY=... AGENT_ADDRESS=... RPC=https://testnet.rpc.intuition.systems/http CHAIN_ID=13579 MULTIVAULT=0x2Ece8D4dEdcB9918A398528f3fa4688b1d2CAB91 DELEGATION_MANAGER=0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3 node intuition-lifecycle.mjs

const RPC = process.env.RPC || \"https://testnet.rpc.intuition.systems/http\";
const CHAIN_ID = BigInt(process.env.CHAIN_ID || \"13579\");
const MULTIVAULT = process.env.MULTIVAULT;
const DELEGATION_MANAGER = process.env.DELEGATION_MANAGER;
const DELEGATOR_PK = process.env.DELEGATOR_PRIVATE_KEY;
const DELEGATOR = process.env.DELEGATOR_ADDRESS;
const AGENT_PK = process.env.AGENT_PRIVATE_KEY;
const AGENT = process.env.AGENT_ADDRESS;

if (!RPC || !MULTIVAULT || !DELEGATION_MANAGER || !DELEGATOR_PK || !DELEGATOR || !AGENT_PK || !AGENT) {
  console.error(\"Missing required env vars\");
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(RPC);
const delegatorWallet = new ethers.Wallet(DELEGATOR_PK, provider);

// ---------- DOMAIN HASH ----------
// getDomainHash() reverts via eth_call on mainnet. Try it, fall back to constants.
let domainHash;
try {
  const dm = new ethers.Contract(DELEGATION_MANAGER, [\"function getDomainHash() view returns (bytes32)\"], provider);
  domainHash = await dm.getDomainHash();
} catch {
  const nameHash = ethers.keccak256(ethers.toUtf8Bytes(\"DelegationManager\"));
  const versionHash = ethers.keccak256(ethers.toUtf8Bytes(\"1\"));
  const typeHash = ethers.keccak256(ethers.toUtf8Bytes(\"EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)\"));
  domainHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode([\"bytes32\",\"bytes32\",\"bytes32\",\"uint256\",\"address\"], [typeHash, nameHash, versionHash, CHAIN_ID, DELEGATION_MANAGER])
  );
}
console.log(\"Domain hash:\", domainHash);

// ---------- DELEGATION OBJECT ----------
// Use ROOT_AUTHORITY from on-chain if available, else zero.
let authority;
try {
  const authBytes = await provider.call({ to: DELEGATION_MANAGER, data: \"0x9d1c3b76\" }); // ROOT_AUTHORITY() selector - adjust if different
  authority = \"0x\" + authBytes.slice(-64);
} catch {
  authority = ethers.ZeroHash;
}
console.log(\"Authority:\", authority);

// NOTE: AllowedMethodsEnforcer terms = raw concatenated bytes4, NOT ABI-encoded.
// Use createAtoms selector 0x61403309 as example.
const allowedMethodsTerms = \"0x61403309\";
const limitedCallsTerms = ethers.AbiCoder.defaultAbiCoder().encode([\"uint256\"], [5]);

const caveats = [
  [ALLOWED_METHODS_ENFORCER, allowedMethodsTerms, \"0x\"],
  [LIMITED_CALLS_ENFORCER, limitedCallsTerms, \"0x\"],
];

const salt = BigInt(\"0x\" + ethers.hexlify(ethers.randomBytes(32)).slice(2));

// EIP-712 hashing matches on-chain getDelegationHash (standard OpenZeppelin v4)
const DELEGATION_TYPEHASH = ethers.keccak256(ethers.toUtf8Bytes(\"Delegation(address delegate,address delegator,bytes32 authority,Caveat[] caveats,uint256 salt)\"));
const CAVEAT_TYPEHASH = ethers.keccak256(ethers.toUtf8Bytes(\"Caveat(address enforcer,bytes terms)\"));

function caveatPacketHash(enforcer, terms) {
  const termsHash = ethers.keccak256(terms);
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode([\"bytes32\",\"address\",\"bytes32\"], [CAVEAT_TYPEHASH, enforcer, termsHash])
  );
}

function caveatsArrayHash(caveats) {
  const hashes = caveats.map(c => caveatPacketHash(c[0], c[1]));
  let concat = \"0x\";
  for (const h of hashes) concat += h.slice(2);
  return ethers.keccak256(concat);
}

function computeDelegationHash(delegate, delegator, auth, caveats, salt) {
  const enc = ethers.AbiCoder.defaultAbiCoder().encode(
    [\"bytes32\",\"address\",\"address\",\"bytes32\",\"bytes32\",\"uint256\"],
    [DELEGATION_TYPEHASH, delegate, delegator, auth, caveatsArrayHash(caveats), salt]
  );
  return ethers.keccak256(enc);
}

const delegation = { delegate: AGENT, delegator: DELEGATOR, authority, caveats, salt, signature: \"0x\" };
const delegationHash = computeDelegationHash(delegation.delegate, delegation.delegator, delegation.authority, delegation.caveats, delegation.salt);
console.log(\"Computed delegation hash:\", delegationHash);

// ---------- SIGN ----------
const structHash = ethers.keccak256(
  ethers.AbiCoder.defaultAbiCoder().encode(
    [\"bytes32\",\"address\",\"address\",\"bytes32\",\"bytes32\",\"uint256\"],
    [DELEGATION_TYPEHASH, delegation.delegate, delegation.delegator, delegation.authority, caveatsArrayHash(delegation.caveats), delegation.salt]
  )
);
const digest = ethers.keccak256(ethers.concat([\"0x1901\", domainHash, structHash]));
const signingKey = new ethers.SigningKey(DELEGATOR_PK);
const sig = signingKey.sign(ethers.getBytes(digest)).serialized;
delegation.signature = sig;

const recovered = ethers.recoverAddress(digest, sig);
console.log(\"Signature valid:\", recovered.toLowerCase() === DELEGATOR.toLowerCase());

// ---------- WRITE ----------
console.log(\"\\n=== Building createAtoms write tx ===\");
const atomData = ethers.hexlify(ethers.toUtf8Bytes(\"caip10:eip155:\" + CHAIN_ID + \":\" + AGENT + \"-lifecycle-\" + Date.now()));
const atomCost = await new ethers.Contract(MULTIVAULT, [\"function getAtomCost() view returns (uint256)\"], provider).getAtomCost();
const innerCalldata = new ethers.Contract(MULTIVAULT, [\"function createAtoms(bytes[],uint256[]) payable returns (bytes32[])\"], provider).interface.encodeFunctionData(\"createAtoms\", [[atomData], [atomCost]]);

// execCallData MUST use solidityPacked, NOT abi.encode
const execCallData = ethers.solidityPacked([\"address\",\"uint256\",\"bytes\"], [MULTIVAULT, atomCost, innerCalldata]);

// Permission context: abi.encode(Delegation[], bytes32)
const permContext = ethers.AbiCoder.defaultAbiCoder().encode(
  [\"(address delegate,address delegator,bytes32 authority,(address enforcer,bytes terms,bytes args)[] caveats,uint256 salt,bytes signature)[]\",\"bytes32\"],
  [[delegation], delegationHash]
);

const MODE_SINGLE = \"0x0000000000000000000000000000000000000000000000000000000000000000\";
const outerIface = new ethers.Interface([\"function redeemDelegations(bytes[],bytes32[],bytes[]) external\"]);
const outerCalldata = outerIface.encodeFunctionData(\"redeemDelegations\", [[permContext], [MODE_SINGLE], [execCallData]]);

console.log(\"Redeem calldata ready. Value=0. DO NOT auto-broadcast in unattended mode.\");
console.log(\"To:\", DELEGATION_MANAGER);
console.log(\"Data:\", outerCalldata);
console.log(\"Delegation hash:\", delegationHash);

// ---------- REVOKE ----------
console.log(\"\\n=== Revoke via disableDelegation ===\");
const dmIface = new ethers.Interface([\"function disableDelegation((address delegate,address delegator,bytes32 authority,(address enforcer,bytes terms,bytes args)[] caveats,uint256 salt,bytes signature)) external\"]);
const disableCalldata = dmIface.encodeFunctionData(\"disableDelegation\", [delegation]);
console.log(\"Disable calldata:\", disableCalldata);

// ---------- VERIFY ----------
const disabledCheck = new ethers.Contract(DELEGATION_MANAGER, [\"function disabledDelegations(bytes32) view returns (bool)\"], provider);
const isDisabled = await disabledCheck.disabledDelegations(delegationHash);
console.log(\"Delegation disabled?\", isDisabled);
