import { ethers } from 'ethers';
import crypto from 'crypto';

// --- Config ---
const RPC = 'https://rpc.intuition.systems/http';
const CHAIN_ID = 1155;
const DELEGATION_MANAGER = '0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3';
const DELEGATOR = '0x61A20dE84D7E5C422Af323D47497ED3bf43Fa5ee';
const DELEGATOR_PK = '0xe541f066dd79dc125d45aa98c27bc0a2c722432d4c2e820e0e09920f59ba5634';
const AGENT = '0xe9BfdEC6Fa795a24e3069292248d9d16570E050d';
const AGENT_PK = '0xa398c7e204107578e4fa6ff76dc382071b370bd0ac569e58551c7cb7a5515fc4';

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const delegatorWallet = new ethers.Wallet(DELEGATOR_PK, provider);
  const agentWallet = new ethers.Wallet(AGENT_PK, provider);

  // 1. Read domain hash from chain
  const dm = new ethers.Contract(DELEGATION_MANAGER, [
    'function getDomainHash() view returns (bytes32)',
    'function getDelegationHash((address delegator,address delegate,bytes32 authority,(address enforcer,bytes terms,bytes args)[] caveats,uint256 salt,bytes signature) delegation) view returns (bytes32)',
  ], provider);

  const domainHash = await dm.getDomainHash();
  console.log('Domain hash:', domainHash);

  // 2. Build delegation
  const salt = BigInt('0x' + crypto.randomBytes(32).toString('hex'));
  const authority = ethers.ZeroHash;
  const caveats = [];

  const delegation = {
    delegator: DELEGATOR,
    delegate: AGENT,
    authority: authority,
    caveats: caveats,
    salt: salt,
    signature: '0x',
  };

  // 3. Compute struct hash on-chain
  const structHash = await dm.getDelegationHash(delegation);
  console.log('Struct hash (on-chain):', structHash);

  // 4. Sign with ethers built-in EIP-712 (v4)
  const domain = {
    name: 'DelegationManager',
    version: '1',
    chainId: CHAIN_ID,
    verifyingContract: DELEGATION_MANAGER
  };

  const types = {
    Delegation: [
      { name: 'delegator', type: 'address' },
      { name: 'delegate', type: 'address' },
      { name: 'authority', type: 'bytes32' },
      { name: 'caveats', type: 'Caveat[]' },
      { name: 'salt', type: 'uint256' },
      { name: 'signature', type: 'bytes' }
    ],
    Caveat: [
      { name: 'enforcer', type: 'address' },
      { name: 'terms', type: 'bytes' },
      { name: 'args', type: 'bytes' }
    ]
  };

  const signature = await delegatorWallet.signDigest(digest);
  console.log('Signature:', signature);

  delegation.signature = signature;

  // 5. Signature recovery check (A5 fix)
  const recovered = ethers.verifyTypedData(
    { name: "DelegationManager", version: "1", chainId: CHAIN_ID, verifyingContract: DELEGATION_MANAGER },
    {
      Delegation: [
        { name: "delegator", type: "address" },
        { name: "delegate", type: "address" },
        { name: "authority", type: "bytes32" },
        { name: "caveats", type: "Caveat[]" },
        { name: "salt", type: "uint256" },
        { name: "signature", type: "bytes" }
      ],
      Caveat: [
        { name: "enforcer", type: "address" },
        { name: "terms", type: "bytes" },
        { name: "args", type: "bytes" }
      ]
    },
    delegation,
    signature
  );

  if (recovered.toLowerCase() !== DELEGATOR.toLowerCase()) {
    throw new Error(`Signature recovery mismatch: expected ${DELEGATOR}, got ${recovered}`);
  }
  console.log('Signature recovery verified:', recovered);

  // 6. Compute permission context
  const encodedDelegation = ethers.AbiCoder.defaultAbiCoder().encode(
    ['(address delegator, address delegate, bytes32 authority, (address enforcer, bytes terms, bytes args)[] caveats, uint256 salt, bytes signature)'],
    [delegation]
  );
  const permissionContext = ethers.keccak256(encodedDelegation);
  console.log('Permission context:', permissionContext);

  // 6. Build execution call data (ERC-7579 single call format)
  const executionCallData = ethers.AbiCoder.defaultAbiCoder().encode(
    ['(address target, uint256 value, bytes callData)'],
    [{ target: DELEGATION_MANAGER, value: 0n, callData: '0x' }]
  );

  const MODE_SINGLE_DEFAULT = ethers.ZeroHash;

  // 7. Try redeemDelegations first (agent sends tx)
  console.log('\n--- Trying redeemDelegations ---');
  try {
    const redeemIface = new ethers.Interface([
      'function redeemDelegations(bytes[] calldata _permissionContexts, bytes32[] calldata _modes, bytes[] calldata _executionCallData) external'
    ]);
    const redeemData = redeemIface.encodeFunctionData('redeemDelegations', [[permissionContext], [MODE_SINGLE_DEFAULT], [executionCallData]]);

    const tx = await agentWallet.sendTransaction({
      to: DELEGATION_MANAGER,
      data: redeemData,
      gasLimit: 300000,
    });
    console.log('redeemDelegations tx:', tx.hash);
    const receipt = await tx.wait();
    console.log('redeemDelegations confirmed in block:', receipt.blockNumber);
    console.log('Status:', receipt.status === 1 ? 'SUCCESS' : 'FAILED');
    return;
  } catch (err) {
    console.log('redeemDelegations failed:', err.message);
  }

  // 8. Fallback: enableDelegation (delegator sends tx)
  console.log('\n--- Trying enableDelegation ---');
  try {
    const enableIface = new ethers.Interface([
      'function enableDelegation((address delegator,address delegate,bytes32 authority,(address enforcer,bytes terms,bytes args)[] caveats,uint256 salt,bytes signature) delegation) external'
    ]);
    const enableData = enableIface.encodeFunctionData('enableDelegation', [delegation]);

    const tx = await delegatorWallet.sendTransaction({
      to: DELEGATION_MANAGER,
      data: enableData,
      gasLimit: 200000,
    });
    console.log('enableDelegation tx:', tx.hash);
    const receipt = await tx.wait();
    console.log('enableDelegation confirmed in block:', receipt.blockNumber);
    console.log('Status:', receipt.status === 1 ? 'SUCCESS' : 'FAILED');
  } catch (err) {
    console.log('enableDelegation failed:', err.message);
  }
}

main().catch(console.error);
