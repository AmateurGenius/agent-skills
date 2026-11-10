#!/usr/bin/env node
// probe-simulate-only.cjs — the simulate-only sibling of redeem-delegation.cjs.
//
// Identical flow (load → signature → revocation → calldata → preview → simulate) but it
// STOPS before any send path: there is no wallet, no --broadcast, no transaction. Use this
// when a probe must be incapable of causing harm.
//
// Nothing deployment-specific is hardcoded: the agent comes from the delegation's `delegate`,
// Main from the Hybrid's on-chain `owner()`, and the costs, curve and MultiVault from the
// selected chain (see networks.cjs).
//
// Usage:
//   node probe-simulate-only.cjs <signed-delegation.json> --op deposit --term 0xTERM_ID [--amount 0.001]
//   node probe-simulate-only.cjs <signed-delegation.json> --op create-atom --atom-data ipfs://bafy…
//   node probe-simulate-only.cjs <signed-delegation.json> --op create-triple --subject 0x.. --predicate 0x.. --object 0x..
//   add --chain mainnet for chain 1155 (default testnet)
const ethers = require('ethers');
const fs = require('fs');
const path = require('path');
const { DELEGATION_MANAGER, resolveNetwork } = require('./networks.cjs');

const MULTIVAULT_ABI = [
  'function getAtomCost() view returns (uint256)',
  'function getTripleCost() view returns (uint256)',
  'function getBondingCurveConfig() view returns ((address registry, uint256 defaultCurveId))',
  'function calculateAtomId(bytes data) view returns (bytes32)',
  'function calculateTripleId(bytes32 subjectId, bytes32 predicateId, bytes32 objectId) view returns (bytes32)',
];

function encodeBytesArray(elements) {
  const N = elements.length;
  let head = N.toString(16).padStart(64, '0');
  let offsets = [], tailLen = 0;
  for (const el of elements) {
    offsets.push(32 * N + tailLen);
    tailLen += 32 + Math.ceil(el.length / 64) * 64;
  }
  head += offsets.map(o => o.toString(16).padStart(64, '0')).join('');
  let tail = '';
  for (const el of elements) {
    tail += (el.length / 2).toString(16).padStart(64, '0');
    tail += el.padEnd(Math.ceil(el.length / 64) * 64, '0');
  }
  return head + tail;
}

async function main() {
  const args = process.argv.slice(2);
  const getOpt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
  const op = getOpt('op', 'deposit');

  // Positional args only — an option's VALUE must not be mistaken for a filename.
  const VALUE_OPTS = ['--chain', '--op', '--amount', '--term', '--atom-data', '--subject', '--predicate', '--object'];
  const positionals = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) { if (VALUE_OPTS.includes(a)) i++; continue; }
    positionals.push(a);
  }
  const jsonPath = positionals[0];
  if (!jsonPath) {
    console.error('Usage: node probe-simulate-only.cjs <signed-delegation.json> --op <deposit|create-atom|create-triple> [--chain testnet|mainnet] [options]');
    process.exit(1);
  }

  const chainName = getOpt('chain', 'testnet');
  let NET;
  try { NET = resolveNetwork(chainName); }
  catch (e) { console.error('   ' + e.message); process.exit(1); }
  const { chainId, multivault: MULTIVAULT } = NET;

  // ── validate op arguments before any network call ─────────────────────────────
  if (!['deposit', 'create-atom', 'create-triple'].includes(op)) {
    console.error('   unknown op: ' + op + ' — use deposit, create-atom or create-triple');
    process.exit(1);
  }
  if (op === 'deposit' && !getOpt('term', '')) {
    console.error('   --term 0x<termId> required for deposit (atom or triple vault)');
    process.exit(1);
  }
  if (op === 'create-atom') {
    const atomUri = getOpt('atom-data', null);
    if (!atomUri) { console.error('   --atom-data is required: pass the pinned ipfs:// URI (or caip10:…).'); process.exit(1); }
    if (!/^ipfs:\/\//.test(atomUri) && !/^caip10:/.test(atomUri)) {
      console.error('   --atom-data must be an ipfs:// URI or a caip10: address. Plain strings create legacy duplicate atoms.');
      process.exit(1);
    }
  }

  const provider = new ethers.JsonRpcProvider(NET.rpc);
  const signed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const delegation = signed.delegation || signed;
  const hybrid = delegation.delegator;
  const AGENT = delegation.delegate;

  const hybridC = new ethers.Contract(hybrid, [
    'function owner() view returns (address)',
    'function isValidSignature(bytes32,bytes) view returns (bytes4)',
  ], provider);
  const code = await provider.getCode(hybrid);
  if (code === '0x') {
    console.error(`   delegator ${hybrid} has no code on ${NET.name} (${chainId}) — deploy the Hybrid first.`);
    process.exit(1);
  }
  const MAIN = await hybridC.owner();
  console.log(`1. delegation loaded — delegator: ${hybrid} | agent: ${AGENT} | main: ${MAIN} | chain: ${NET.name} (${chainId})`);

  // 2. signature + revocation, both read from the contract
  const dm = new ethers.Contract(DELEGATION_MANAGER, [
    'function getDelegationHash((address,address,bytes32,(address,bytes,bytes)[],uint256,bytes) _input) view returns (bytes32)',
    'function getDomainHash() view returns (bytes32)',
    'function disabledDelegations(bytes32) view returns (bool)',
  ], provider);
  const structHash = await dm.getDelegationHash([
    delegation.delegate, delegation.delegator, delegation.authority,
    delegation.caveats.map(c => [c.enforcer, c.terms, c.args || '0x']),
    delegation.salt, delegation.signature,
  ]);
  const domainHash = await dm.getDomainHash();
  const digest = ethers.keccak256(ethers.concat(['0x1901', domainHash, structHash]));
  const check = await hybridC.isValidSignature(digest, delegation.signature);
  console.log('2. on-chain signature check:', check, check === '0x1626ba7e' ? '✅ VALID' : '❌ INVALID');
  if (check !== '0x1626ba7e') {
    console.error('   Re-sign via the signing page — it verifies before accepting.');
    process.exit(1);
  }
  const disabled = await dm.disabledDelegations(structHash);
  console.log('2b. revocation check:', disabled ? '❌ REVOKED — stop.' : '✅ not revoked');
  if (disabled) process.exit(1);

  // 3. chain state + calldata
  const mv = new ethers.Contract(MULTIVAULT, MULTIVAULT_ABI, provider);
  const atomCost = await mv.getAtomCost();
  const tripleCost = await mv.getTripleCost();
  const [, curveId] = await mv.getBondingCurveConfig();

  let value, innerCalldata;
  if (op === 'deposit') {
    value = ethers.parseEther(getOpt('amount', '0.001'));
    const term = getOpt('term', '').replace('0x', '').toLowerCase();
    if (term.length !== 64) { console.error('   --term must be 32 bytes of hex'); process.exit(1); }
    innerCalldata = '2fb1d270' +
      MAIN.toLowerCase().replace('0x', '').padStart(64, '0') +
      term.padStart(64, '0') +
      curveId.toString(16).padStart(64, '0') +
      '0000000000000000000000000000000000000000000000000000000000000000';
  } else if (op === 'create-atom') {
    value = atomCost;
    const atomData = ethers.hexlify(ethers.toUtf8Bytes(getOpt('atom-data')));
    const iface = new ethers.Interface(['function createAtoms(bytes[],uint256[]) payable']);
    innerCalldata = iface.encodeFunctionData('createAtoms', [[atomData], [atomCost]]).slice(2);
  } else {
    value = tripleCost;
    const s = getOpt('subject', ''), p = getOpt('predicate', ''), o = getOpt('object', '');
    for (const [name, v] of [['subject', s], ['predicate', p], ['object', o]]) {
      if (!v.startsWith('0x') || v.length !== 66) { console.error('   --' + name + ' 0x<64-hex> required'); process.exit(1); }
    }
    const iface = new ethers.Interface(['function createTriples(bytes32[],bytes32[],bytes32[],uint256[]) payable']);
    innerCalldata = iface.encodeFunctionData('createTriples', [[s], [p], [o], [tripleCost]]).slice(2);
  }

  const execution = MULTIVAULT.toLowerCase().replace('0x', '') + value.toString(16).padStart(64, '0') + innerCalldata;

  const core = require(path.join(__dirname, 'node_modules/@metamask/delegation-core/dist/index.cjs'));
  const permissionContext = core.encodeDelegations([delegation]);
  const ctxArray = encodeBytesArray([permissionContext.slice(2)]);
  const modesArray = '0000000000000000000000000000000000000000000000000000000000000001' +
                     '0000000000000000000000000000000000000000000000000000000000000000';
  const execArray = encodeBytesArray([execution]);
  const offCtx = 96, offModes = offCtx + ctxArray.length / 2, offExecs = offModes + modesArray.length / 2;
  const calldata = 'cef6d209' +
    offCtx.toString(16).padStart(64, '0') + offModes.toString(16).padStart(64, '0') + offExecs.toString(16).padStart(64, '0') +
    ctxArray + modesArray + execArray;
  console.log(`3. calldata built: ${calldata.length / 2} bytes | value: ${ethers.formatEther(value)} TRUST from Hybrid`);

  // 4. simulate — the only step this probe performs beyond building
  try {
    await provider.call({ from: AGENT, to: DELEGATION_MANAGER, data: '0x' + calldata });
    console.log('4. simulate: ✅ NO REVERT');
  } catch (e) {
    console.error('4. simulate: ❌ REVERTS —', (e.info?.error?.message || e.message).slice(0, 120));
    process.exit(1);
  }

  console.log('--- probe stopped before any send path (nothing broadcast) ---');
}
main().catch(e => { console.error('ERR', (e.message || String(e)).slice(0, 200)); process.exit(1); });
