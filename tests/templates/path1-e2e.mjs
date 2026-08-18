import { ethers } from "ethers";
import crypto from "crypto";

// ---------- TESTNET CONFIG ----------
const DELEGATOR = "0x61A20dE84D7E5C422Af323D47497ED3bf43Fa5ee"; // EIP-7702 upgraded EOA
const DELEGATE = DELEGATOR; // EOA broadcast: delegate == delegator == msg.sender
const DELEGATION_MANAGER = "0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3";
const MULTIVAULT = "0x2Ece8D4dEdcB9918A398528f3fa4688b1d2CAB91";
const CHAIN_ID = 13579;
const RPC = "https://testnet.rpc.intuition.systems/http";

const ALLOWED_METHODS_ENFORCER = "0x2c21fD0Cb9DC8445CB3fb0DC5E7Bb0Aca01842B5";
const LIMITED_CALLS_ENFORCER = "0x04658B29F6b82ed55274221a06Fc97D318E25416";

const provider = new ethers.JsonRpcProvider(RPC);
const DELEGATOR_PK = process.env.DELEGATOR_PRIVATE_KEY;
if (!DELEGATOR_PK) {
  console.error("ERROR: DELEGATOR_PRIVATE_KEY not set in environment");
  process.exit(1);
}
const delegatorWallet = new ethers.Wallet(DELEGATOR_PK, provider);

// ---------- TYPEHASHES ----------
const DELEGATION_TYPEHASH = ethers.keccak256(
  ethers.toUtf8Bytes("Delegation(address delegate,address delegator,bytes32 authority,Caveat[] caveats,uint256 salt)Caveat(address enforcer,bytes terms)")
);
const CAVEAT_TYPEHASH = ethers.keccak256(ethers.toUtf8Bytes("Caveat(address enforcer,bytes terms)"));
const ROOT_AUTHORITY = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

// ---------- HASH HELPERS ----------
function getCaveatPacketHash(enforcer, terms) {
  const termsHash = ethers.keccak256(terms);
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes32", "address", "bytes32"],
    [CAVEAT_TYPEHASH, enforcer, termsHash]
  );
  return ethers.keccak256(encoded);
}

function getCaveatArrayPacketHash(caveats) {
  const hashes = caveats.map((c) => getCaveatPacketHash(c.enforcer, c.terms));
  let concatenated = "0x";
  for (const h of hashes) {
    concatenated += h.slice(2);
  }
  return ethers.keccak256(concatenated);
}

function getDelegationHash(delegate, delegator, authority, caveats, salt) {
  const caveatsHash = getCaveatArrayPacketHash(caveats);
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes32", "address", "address", "bytes32", "bytes32", "uint256"],
    [DELEGATION_TYPEHASH, delegate, delegator, authority, caveatsHash, BigInt(salt)]
  );
  return ethers.keccak256(encoded);
}

async function main() {
  console.log("=== PATH 1: EIP-7702 DIRECT DELEGATION ===\n");

  // Step 0: Verify account is upgraded
  console.log("0. Verifying EIP-7702 upgrade...");
  const code = await provider.getCode(DELEGATOR);
  const isUpgraded = code.length > 2;
  console.log(`   Code length: ${code.length} bytes`);
  console.log(`   Is upgraded: ${isUpgraded}`);
  if (!isUpgraded) {
    console.error("   Account is NOT upgraded. Path 1 requires an EIP-7702 upgraded account.");
    process.exit(1);
  }

  // Step 1: Read domain hash on-chain
  const domainHash = await provider.call({
    to: DELEGATION_MANAGER,
    data: "0x83ebb771" // getDomainHash()
  });
  console.log("\n1. Domain hash (on-chain):", domainHash);

  // Step 2: Build delegation
  const salt = BigInt("0xa9bc5458e3ed352df2ea4abe9e0bba41173513b9000000000000000000000000");

  const allowedMethodsTerms = "0x61403309";
  const limitedCallsTerms = ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [5]);

  const caveats = [
    { enforcer: ALLOWED_METHODS_ENFORCER, terms: allowedMethodsTerms, args: "0x" },
    { enforcer: LIMITED_CALLS_ENFORCER, terms: limitedCallsTerms, args: "0x" }
  ];

  const delegation = {
    delegate: DELEGATE,
    delegator: DELEGATOR,
    authority: ROOT_AUTHORITY,
    caveats,
    salt,
    signature: "0x"
  };

  // Step 3: Compute delegation hash and verify on-chain
  const delegationHash = getDelegationHash(delegation.delegate, delegation.delegator, delegation.authority, delegation.caveats, delegation.salt);
  console.log("\n2. Computed delegation hash:", delegationHash);

  const onChainHashBytes = await provider.call({
    to: DELEGATION_MANAGER,
    data: "0x66134607" + ethers.AbiCoder.defaultAbiCoder().encode(
      ["(address delegate,address delegator,bytes32 authority,(address enforcer,bytes terms,bytes args)[] caveats,uint256 salt,bytes signature)"],
      [delegation]
    ).slice(2),
  });
  const onChainHash = "0x" + onChainHashBytes.slice(-64);
  console.log("3. On-chain getDelegationHash:", onChainHash);
  console.log("   Hash match:", delegationHash === onChainHash);
  if (delegationHash !== onChainHash) throw new Error("Hash mismatch!");

  // Step 4: Sign EIP-712 digest
  const structHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "address", "address", "bytes32", "bytes32", "uint256"],
      [DELEGATION_TYPEHASH, delegation.delegate, delegation.delegator, delegation.authority, getCaveatArrayPacketHash(delegation.caveats), delegation.salt]
    )
  );
  const digestBytes = ethers.concat([ethers.getBytes("0x1901"), ethers.getBytes(domainHash), ethers.getBytes(structHash)]);
  const digest = ethers.keccak256(digestBytes);
  console.log("\n4. EIP-712 digest:", digest);

  const signingKey = new ethers.SigningKey(DELEGATOR_PK);
  const signature = signingKey.sign(ethers.getBytes(digest)).serialized;
  console.log("   Signature:", signature);

  const recovered = ethers.recoverAddress(digest, signature);
  console.log("   Recovered:", recovered);
  console.log("   Match:", recovered.toLowerCase() === DELEGATOR.toLowerCase());

  delegation.signature = signature;

  // Step 5: ISOLATED ERC-1271 TEST (Path 1 specific)
  console.log("\n5. ISOLATED ERC-1271 TEST: isValidSignature on upgraded account");
  const isValidSigCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes32", "bytes"],
    [digest, signature]
  );
  const erc1271Result = await provider.call({
    to: DELEGATOR,
    data: "0x1626ba7e" + isValidSigCalldata.slice(2) // isValidSignature(bytes32,bytes)(bytes4)
  });
  console.log("   ERC1271 result:", erc1271Result);
  const ERC1271_MAGIC = "0x1626ba7e";
  // NOTE: EVM pads bytes4 return to 32 bytes. Use startsWith, not strict equality.
  const erc1271Pass = erc1271Result.startsWith(ERC1271_MAGIC);
  console.log("   ERC-1271 validation:", erc1271Pass ? "PASS" : "FAIL");

  if (!erc1271Pass) {
    console.error("\n   STOPPING: ERC-1271 validation failed. Path 1 blocked at isolated test.");
    process.exit(1);
  }
  console.log("   Proceeding to full Path 1 lifecycle...");

  // Step 6: Build redeemDelegations calldata
  const atomData = ethers.toUtf8Bytes("caip10:eip155:13579:0x61A20dE84D7E5C422Af323D47497ED3bf43Fa5ee-e2e-path1-" + Date.now());
  const atomCost = 1000000001000000n;

  const innerIface = new ethers.Interface(["function createAtoms(bytes[],uint256[]) payable returns (bytes32[])"]);
  const innerCalldata = innerIface.encodeFunctionData("createAtoms", [[ethers.hexlify(atomData)], [atomCost]]);

  const execCallData = ethers.solidityPacked(
    ["address", "uint256", "bytes"],
    [MULTIVAULT, atomCost, innerCalldata]
  );

  const permContext = ethers.AbiCoder.defaultAbiCoder().encode(
    [
      "(address delegate,address delegator,bytes32 authority,(address enforcer,bytes terms,bytes args)[] caveats,uint256 salt,bytes signature)[]",
      "bytes32"
    ],
    [
      [delegation],
      delegationHash
    ]
  );

  const MODE_SINGLE_DEFAULT = "0x0000000000000000000000000000000000000000000000000000000000000000";
  const outerIface = new ethers.Interface(["function redeemDelegations(bytes[],bytes32[],bytes[]) external"]);
  const redeemCalldata = outerIface.encodeFunctionData("redeemDelegations", [
    [permContext],
    [MODE_SINGLE_DEFAULT],
    [execCallData]
  ]);

  // Pre-compute atom ID
  const atomIdCalldata = innerIface.encodeFunctionData("createAtoms", [[ethers.hexlify(atomData)], [atomCost]]);
  const atomIdRaw = await provider.call({ to: MULTIVAULT, data: atomIdCalldata, value: atomCost });
  const atomIdHex = "0x" + atomIdRaw.slice(-64);
  console.log("\n6. Atom ID:", atomIdHex);

  // Step 7: Broadcast redeemDelegations
  console.log("\n7. Broadcasting redeemDelegations via EIP-7702 upgraded account...");
  const writeTx = await delegatorWallet.sendTransaction({
    to: DELEGATION_MANAGER,
    data: redeemCalldata,
    value: 0n
  });
  console.log("   Tx hash:", writeTx.hash);
  const writeReceipt = await writeTx.wait();
  console.log("   Status:", writeReceipt.status === 1 ? "SUCCESS" : "FAILED");
  console.log("   Gas used:", writeReceipt.gasUsed.toString());

  // Step 8: Verify atom created
  console.log("\n8. Verifying atom creation...");
  const isTermCreated = await provider.call({
    to: MULTIVAULT,
    data: "0xf5719008" + atomIdHex.slice(2)
  });
  console.log("   isTermCreated:", isTermCreated === "0x0000000000000000000000000000000000000000000000000000000000000001" ? "TRUE" : "FALSE");

  // Step 9: Revoke
  console.log("\n9. Revoking delegation...");
  const disableIface = new ethers.Interface(["function disableDelegation((address delegate,address delegator,bytes32 authority,(address enforcer,bytes terms,bytes args)[] caveats,uint256 salt,bytes) delegation) external"]);
  const disableCalldata = disableIface.encodeFunctionData("disableDelegation", [[
    delegation.delegate,
    delegation.delegator,
    delegation.authority,
    delegation.caveats.map(c => [c.enforcer, c.terms, c.args]),
    delegation.salt,
    delegation.signature
  ]]);

  const revokeTx = await delegatorWallet.sendTransaction({
    to: DELEGATION_MANAGER,
    data: disableCalldata,
    value: 0n
  });
  console.log("   Revoke tx hash:", revokeTx.hash);
  const revokeReceipt = await revokeTx.wait();
  console.log("   Status:", revokeReceipt.status === 1 ? "SUCCESS" : "FAILED");

  // Step 10: Verify revocation
  console.log("\n10. Verifying revocation...");
  const disabledAfter = await provider.call({
    to: DELEGATION_MANAGER,
    data: "0x2d40d052" + ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [delegationHash]).slice(2)
  });
  const isDisabledAfter = parseInt(disabledAfter, 16) === 1;
  console.log("   disabledDelegations(hash):", isDisabledAfter);

  // Step 11: Try to use revoked delegation
  console.log("\n11. Attempting redeemDelegations with revoked delegation...");
  try {
    const blockedTx = await delegatorWallet.sendTransaction({
      to: DELEGATION_MANAGER,
      data: redeemCalldata,
      value: 0n
    });
    const blockedReceipt = await blockedTx.wait();
    console.log("   UNEXPECTED: write succeeded after revoke");
  } catch (e) {
    console.log("   Blocked at broadcast (expected):", (e.shortMessage || e.message || "").slice(0, 300));
  }

  // Save output
  const fs = await import("fs");
  fs.writeFileSync("/data/data/com.termux/files/home/tmp/path1-e2e-result.json", JSON.stringify({
    path: "eip7702-direct",
    erc1271Probe: erc1271Pass,
    domainHash,
    delegationHash,
    atomData: ethers.hexlify(atomData),
    atomCost: atomCost.toString(),
    writeTx: writeTx.hash,
    writeStatus: writeReceipt.status === 1 ? "success" : "failed",
    revokeTx: revokeTx.hash,
    revoked: isDisabledAfter,
    postRevokeBlocked: isDisabledAfter ? "confirmed_disabled" : "unexpected"
  }, null, 2));
  console.log("\n12. Saved to path1-e2e-result.json");
}

main().catch(console.error);
