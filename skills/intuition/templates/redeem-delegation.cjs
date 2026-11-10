#!/usr/bin/env node
// redeem-delegation.cjs — Redeem a SIGNED delegation using the AGENT'S OWN KEY.
//
// The delegation JSON comes from the signing page (Main Account signed via MetaMask popup;
// the page verified the signature on-chain before accepting). This script NEVER touches
// the Main Account key — it only sends redeemDelegations from ~/.intuition/agent-wallet.json.
//
// ⚠️ DEFAULT IS DRY-RUN. This script SIMULATES unless you pass BOTH --broadcast and --yes.
//
// Usage:
//   node redeem-delegation.cjs <signed-delegation.json> --op deposit --term 0xTERM_ID --amount 0.001
//   node redeem-delegation.cjs <signed-delegation.json> --op create-atom --atom-data ipfs://bafy…
//   node redeem-delegation.cjs <signed-delegation.json> --op create-triple --subject 0x.. --predicate 0x.. --object 0x..
//
// Modes:
//   --dry-run     (DEFAULT) simulate only, emit JSON, broadcast nothing
//   --broadcast   opt in to the real send; requires --yes as a second acknowledgement
//
// Options:
//   --chain testnet|mainnet   (default testnet)
//
// NOTHING DEPLOYMENT-SPECIFIC IS HARDCODED. The agent address comes from the delegation's own
// `delegate` field, the Main account from the Hybrid's on-chain owner(), and the atom/triple
// costs and curve id are read from MultiVault at run time — they differ per chain (mainnet's
// atom cost is 100x testnet's), so hardcoding them silently breaks the other network.
//
// Output: a single JSON object on stdout (see RESULT_SCHEMA below) so an agent never has to
// parse prose.
//   { tool, mode, op, decision:'proceed'|'halt'|'reject', reason, chainId, chain, agent, main,
//     delegator, delegate, calldataBytes, valueTrustWei, valueTrusted, preview,
//     simulation:{ok,error,errorName}, signatureCheck, revocation, tx, createdIds }
//
// Steps: load JSON → resolve network/addresses/costs on-chain → validate signature → check
//        revocation → build calldata → preview → simulate → (STOP, default) → send from the
//        agent wallet → verify receipt → print created IDs.
const ethers = require('ethers');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { NETWORKS, DELEGATION_MANAGER, resolveNetwork } = require('./networks.cjs');

const MULTIVAULT_ABI = [
  'function getAtomCost() view returns (uint256)',
  'function getTripleCost() view returns (uint256)',
  'function getBondingCurveConfig() view returns ((address registry, uint256 defaultCurveId))',
  'function previewDeposit(bytes32 termId, uint256 curveId, uint256 assets) view returns (uint256 shares, uint256 assetsAfterFees)',
  'function previewAtomCreate(bytes32 termId, uint256 assets) view returns (uint256 shares, uint256 assetsAfterFixedFees, uint256 assetsAfterFees)',
  'function previewTripleCreate(bytes32 termId, uint256 assets) view returns (uint256 shares, uint256 assetsAfterFixedFees, uint256 assetsAfterFees)',
  'function calculateAtomId(bytes data) view returns (bytes32)',
  'function calculateTripleId(bytes32 subjectId, bytes32 predicateId, bytes32 objectId) view returns (bytes32)',
];

function encodeBytesArray(elements) {
  const N = elements.length;
  let head = N.toString(16).padStart(64, '0');
  let offsets = [], tailLen = 0;
  for (const el of elements) {
    offsets.push(32 * N + tailLen); // relative to after-length
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
    console.error('Usage: node redeem-delegation.cjs <signed-delegation.json> --op <deposit|create-atom|create-triple> [--chain testnet|mainnet] [options]');
    process.exit(1);
  }
  const getOpt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
  const hasFlag = (name) => args.includes('--' + name);
  const op = getOpt('op', 'deposit');

  // ── network ──────────────────────────────────────────────────────────────────
  const chainName = getOpt('chain', 'testnet');
  let NETWORK;
  try { NETWORK = resolveNetwork(chainName); }
  catch (e) { console.error('   ' + e.message); process.exit(1); }
  const { chainId, rpc: RPC, multivault: MULTIVAULT } = NETWORK;

  // ── BROADCAST GATE ────────────────────────────────────────────────────────────
  // Default is dry-run. Two independent flags are required to move real value,
  // so a single stray flag in a script or a shell-history paste cannot send.
  const broadcast = hasFlag('broadcast');
  const acknowledged = hasFlag('yes');
  const mode = broadcast ? 'broadcast' : 'dry-run';
  if (broadcast && !acknowledged) {
    console.error('❌ REFUSING TO BROADCAST: --broadcast requires --yes as an explicit second acknowledgement.');
    console.error('   Re-run with --dry-run to simulate only (the default).');
    process.exit(2);
  }

  // ── 0. Validate op arguments before any network call ────────────────────────────
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
    if (!atomUri) {
      console.error('   --atom-data is required: pass the pinned ipfs:// URI (or caip10:eip155:{chainId}:{address}).');
      process.exit(1);
    }
    if (!/^ipfs:\/\//.test(atomUri) && !/^caip10:/.test(atomUri)) {
      console.error('   --atom-data must be an ipfs:// URI (from reference/schemas.md) or a caip10: address. Plain strings create legacy duplicate atoms.');
      process.exit(1);
    }
  }
  if (op === 'create-triple') {
    for (const name of ['subject', 'predicate', 'object']) {
      const v = getOpt(name, '');
      if (!v.startsWith('0x') || v.length !== 66) { console.error('   --' + name + ' 0x<64-hex> required'); process.exit(1); }
    }
  }

  const log = (...a) => console.error(...a);   // human output → stderr, JSON stays clean on stdout
  const provider = new ethers.JsonRpcProvider(RPC);

  const result = {
    tool: 'redeem-delegation.cjs', mode, op, chainId, chain: chainName,
    agent: null, main: null, delegator: null, delegate: null,
    calldataBytes: 0, valueTrustWei: '0', valueTrusted: '0', costs: null, preview: null,
    decision: 'proceed', reason: '',
    simulation: { ok: null, error: null, errorName: null },
    signatureCheck: null, revocation: null, tx: null, createdIds: [],
  };
  // Emit JSON on every exit path so a caller can parse without reading prose.
  const emit = (extra) => {
    if (extra) Object.assign(result, extra);
    console.log(JSON.stringify(result, null, 2));
  };

  const signed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const delegation = signed.delegation || signed;
  const hybrid = delegation.delegator;
  result.delegator = hybrid;
  result.delegate = delegation.delegate;

  // ── 1. Resolve the deployment from the delegation + chain, never from constants ──
  // The delegate IS the agent. The Main account is the Hybrid's on-chain owner.
  const AGENT = delegation.delegate;
  const hybridC = new ethers.Contract(hybrid, [
    'function owner() view returns (address)',
    'function isValidSignature(bytes32,bytes) view returns (bytes4)',
  ], provider);
  const hybridCode = await provider.getCode(hybrid);
  if (hybridCode === '0x') {
    emit({ decision: 'halt', reason: `delegator ${hybrid} has no code on ${chainName} (${chainId}) — deploy the Hybrid first (templates/sign-delegation.html, step 2a).` });
    log(`❌ delegator ${hybrid} is not deployed on ${chainName}`);
    process.exit(1);
  }
  const MAIN = await hybridC.owner();
  result.agent = AGENT; result.main = MAIN;

  const mv = new ethers.Contract(MULTIVAULT, MULTIVAULT_ABI, provider);
  const atomCost = await mv.getAtomCost();
  const tripleCost = await mv.getTripleCost();
  const [, curveId] = await mv.getBondingCurveConfig();
  result.costs = {
    atomCost: atomCost.toString(), tripleCost: tripleCost.toString(), curveId: curveId.toString(),
  };
  log(`1. delegation loaded — delegator: ${hybrid} | agent: ${AGENT} | main: ${MAIN} | chain: ${chainName} (${chainId})`);
  log(`1b. chain state — atomCost: ${atomCost} | tripleCost: ${tripleCost} | curveId: ${curveId}`);

  // 2. Validate the signature ON-CHAIN (the same check the page did before accepting)
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
  const sigValid = check === '0x1626ba7e';
  result.signatureCheck = { magic: check, valid: sigValid, digest, structHash };
  log(`2. on-chain signature check: ${check} ${sigValid ? '✅ VALID' : '❌ INVALID'}`);
  if (!sigValid) {
    // 0xffffffff here = the SIGNATURE/DIGEST is wrong, not the caveats. Different failure
    // class from a caveat revert — see operations/create-delegation.md error table.
    emit({ decision: 'reject', reason: 'InvalidERC1271Signature: digest/signature mismatch. isValidSignature returned ' + check + ' instead of 0x1626ba7e.' });
    log('   Re-sign via the signing page — it verifies before accepting.');
    process.exit(1);
  }

  // 2b. Revocation — read the contract's own state. A revoked delegation is a `reject`,
  //     not a `halt`: it can never authorise this action again.
  const disabled = await dm.disabledDelegations(structHash);
  result.revocation = { disabled, delegationHash: structHash };
  if (disabled) {
    log('2b. revocation check: ❌ REVOKED (disabledDelegations = true)');
    emit({ decision: 'reject', reason: 'CannotUseADisabledDelegation: this delegation was revoked. Request a fresh delegation from the delegator (see operations/revoke-delegation.md).' });
    process.exit(1);
  }
  log('2b. revocation check: ✅ not revoked');

  // 3. Build the inner execution (to + value + calldata, raw concat — proven format)
  let value, innerCalldata, previewId, previewFn;
  if (op === 'deposit') {
    value = ethers.parseEther(getOpt('amount', '0.001'));
    const term = getOpt('term', '').replace('0x', '').toLowerCase();
    if (!term || term.length !== 64) { console.error('   --term 0x<termId> required for deposit (atom or triple vault)'); process.exit(1); }
    // deposit(address receiver, bytes32 termId, uint256 curveId, uint256 minShares) — minShares=0 (proven on-chain)
    innerCalldata = '2fb1d270' +
      MAIN.toLowerCase().replace('0x', '').padStart(64, '0') +
      term.padStart(64, '0') +
      curveId.toString(16).padStart(64, '0') +
      '0000000000000000000000000000000000000000000000000000000000000000';
    previewId = '0x' + term.padStart(64, '0');
    previewFn = () => mv.previewDeposit(previewId, curveId, value);
  } else if (op === 'create-atom') {
    // Atoms must be pinned (ipfs://) or CAIP-10 addresses — the same rule as operations/create-atoms.md.
    const atomUri = getOpt('atom-data', null);
    if (!atomUri) { console.error('   --atom-data is required: pass the pinned ipfs:// URI (or caip10:eip155:{chainId}:{address}).'); process.exit(1); }
    if (!/^ipfs:\/\//.test(atomUri) && !/^caip10:/.test(atomUri)) {
      console.error('   --atom-data must be an ipfs:// URI (from reference/schemas.md) or a caip10: address. Plain strings create legacy duplicate atoms.');
      process.exit(1);
    }
    value = atomCost;
    const atomData = ethers.hexlify(ethers.toUtf8Bytes(atomUri));
    const iface = new ethers.Interface(['function createAtoms(bytes[],uint256[]) payable']);
    innerCalldata = iface.encodeFunctionData('createAtoms', [[atomData], [atomCost]]).slice(2);
    previewId = await mv.calculateAtomId(atomData);
    previewFn = () => mv.previewAtomCreate(previewId, atomCost);
  } else if (op === 'create-triple') {
    value = tripleCost;
    const s = getOpt('subject', ''), p = getOpt('predicate', ''), o = getOpt('object', '');
    for (const [name, v] of [['subject', s], ['predicate', p], ['object', o]]) {
      if (!v.startsWith('0x') || v.length !== 66) { console.error('   --' + name + ' 0x<64-hex> required'); process.exit(1); }
    }
    const iface = new ethers.Interface(['function createTriples(bytes32[],bytes32[],bytes32[],uint256[]) payable']);
    innerCalldata = iface.encodeFunctionData('createTriples', [[s], [p], [o], [tripleCost]]).slice(2);
    previewId = await mv.calculateTripleId(s, p, o);
    previewFn = () => mv.previewTripleCreate(previewId, tripleCost);
  } else { console.error('   unknown op:', op); process.exit(1); }

  result.valueTrustWei = value.toString();
  result.valueTrusted = ethers.formatEther(value);

  // 3b. Preview — the skill requires a preview before any write so the caller sees the
  //     expected shares and post-fee assets. A reverting preview stops the operation.
  try {
    const preview = await previewFn();
    result.preview = {
      termId: previewId, expectedShares: preview[0].toString(),
      assetsAfterFees: preview[preview.length - 1].toString(),
    };
    log(`3b. preview — expectedShares: ${preview[0]} | assetsAfterFees: ${preview[preview.length - 1]}`);
  } catch (e) {
    const msg = (e.info?.error?.message || e.message || String(e)).slice(0, 300);
    emit({ decision: 'halt', reason: 'Preview reverted: ' + msg });
    log('3b. preview: ❌ REVERTED — ' + msg);
    process.exit(1);
  }

  const execution = MULTIVAULT.toLowerCase().replace('0x', '') + value.toString(16).padStart(64, '0') + innerCalldata;

  // 4. Assemble redeemDelegations calldata (proven framing)
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
  result.calldataBytes = calldata.length / 2;
  log(`3. calldata built: ${result.calldataBytes} bytes | value: ${result.valueTrusted} TRUST from Hybrid`);

  // 5. Simulate — this is the authoritative gate. A simulation that reverts here would
  //    revert on-chain too, so dry-run and broadcast reach the same verdict.
  let simOk = false, simErr = null, simName = null;
  try {
    await provider.call({ from: AGENT, to: DELEGATION_MANAGER, data: '0x' + calldata });
    simOk = true;
    log('4. simulate: ✅ NO REVERT');
  } catch (e) {
    const msg = e.info?.error?.message || e.message || String(e);
    simErr = msg.slice(0, 300);
    simName = msg.match(/Error\(string\): (\w+)/)?.[1] || msg.match(/0x[0-9a-f]{8}/)?.[0] || null;
    log(`4. simulate: ❌ REVERTS — ${simName || simErr.slice(0, 80)}`);
  }
  result.simulation = { ok: simOk, error: simErr, errorName: simName };

  if (!simOk) {
    // A revert here is a CAVEAT/authority rejection (the enforcer's own selector, e.g.
    // CannotUseADisabledDelegation 0x05baa052), distinct from the signature failure above.
    emit({ decision: 'halt', reason: `Simulation reverted (${simName || 'unknown'}): ${simErr}` });
    process.exit(1);
  }

  // ── DRY-RUN STOP ──────────────────────────────────────────────────────────────
  // Everything above this line is read-only. Nothing below runs unless the caller
  // explicitly passed BOTH --broadcast and --yes.
  if (!broadcast) {
    emit({ decision: 'proceed', reason: 'Simulation passed. Nothing broadcast (dry-run default). Re-run with --broadcast --yes to send.' });
    log('--- dry-run: simulation passed, no transaction sent ---');
    return;
  }

  // 6. Send from the AGENT'S OWN WALLET.
  //    Two signing paths:
  //      - local key file (~/.intuition/agent-wallet.json) — the tested default
  //      - OWS (`ows sign tx`) — used when there is no local key file
  const KEY_FILE = path.join(process.env.HOME, '/.intuition/agent-wallet.json');
  const OWS_NAME = getOpt('ows-name', 'intuition-agent');
  const txPayload = { to: DELEGATION_MANAGER, data: '0x' + calldata, gasLimit: 800_000, gasPrice: 100_000_000n, chainId };
  let tx;
  if (fs.existsSync(KEY_FILE)) {
    const agentWallet = new ethers.Wallet(JSON.parse(fs.readFileSync(KEY_FILE, 'utf8')).privateKey, provider);
    if (agentWallet.address.toLowerCase() !== AGENT.toLowerCase()) {
      emit({ decision: 'halt', reason: 'agent wallet mismatch: ' + KEY_FILE + ' does not hold ' + AGENT });
      process.exit(1);
    }
    tx = await agentWallet.sendTransaction(txPayload);
    log(`5. tx sent (local agent key): ${tx.hash}`);
  } else {
    // OWS path — the key never leaves the OWS vault. It fails loudly if OWS is unavailable.
    const unsigned = ethers.Transaction.from({ ...txPayload, type: 0 }).unsignedSerialized;
    log(`5. signing via OWS wallet "${OWS_NAME}" on chain ${chainId}…`);
    const signed = execFileSync('ows', ['sign', 'tx', '--wallet', OWS_NAME, '--chain', String(chainId), '--tx', unsigned], { encoding: 'utf8' }).trim();
    tx = await provider.broadcastTransaction(signed);
    log(`5. tx sent (OWS): ${tx.hash}`);
  }
  const receipt = await tx.wait();
  log(`6. status: ${receipt.status === 1 ? '✅ SUCCESS' : '❌ FAILED'} | block: ${receipt.blockNumber} | gas: ${receipt.gasUsed}`);

  // 7. Extract created IDs from logs (bytes32 candidates)
  const known = new Set([delegation.salt.toLowerCase(), structHash.toLowerCase(), digest.toLowerCase()]);
  const ids = [];
  for (const entry of receipt.logs) {
    log(`   log: ${entry.address} ${entry.topics[0].slice(0, 22)}...`);
    for (const t of entry.topics.slice(1)) {
      if (t.length === 66 && !known.has(t.toLowerCase())) ids.push(t);
    }
    if (entry.data !== '0x' && entry.data.length >= 66) {
      for (let i = 2; i + 64 <= entry.data.length; i += 64) {
        const w = '0x' + entry.data.slice(i, i + 64);
        if (!known.has(w.toLowerCase()) && !/^0x0+$/.test(w) && BigInt(w) !== curveId) ids.push(w);
      }
    }
  }
  const ok = receipt.status === 1;
  emit({
    decision: ok ? 'proceed' : 'halt',
    reason: ok ? 'Broadcast succeeded.' : 'Broadcast transaction reverted on-chain.',
    tx: { hash: tx.hash, status: receipt.status, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed.toString() },
    createdIds: ids,
  });
}
main().catch(e => {
  console.error('❌', (e.message || String(e)).slice(0, 250));
  console.log(JSON.stringify({ tool: 'redeem-delegation.cjs', decision: 'halt', reason: (e.message || String(e)).slice(0, 250), tx: null }, null, 2));
  process.exit(1);
});
