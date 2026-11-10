// probe-value-lte-footgun.mjs — SINGLE-VARIABLE reproducer for the valueLte=0n footgun.
//
// ScopeType.FunctionCall normalises with `config.valueLte ?? { maxValue: 0n }`.
// There is no unlimited default, so a scope that omits valueLte silently caps
// value at ZERO: every value-bearing call reverts WHILE isValidSignature still
// returns 0x1626ba7e. That combination is the whole trap — a green signature
// check on a permanently unredeemable delegation.
//
// This proves it by holding everything constant except one caveat term:
//   A) terms untouched (ValueLte = 2^255-1)  -> expect NO REVERT
//   B) terms = 0                             -> expect revert
//
// READ-ONLY: eth_call only. It cannot broadcast, move funds, or change state.
//
// Nothing deployment-specific is hardcoded: the Hybrid is the delegation's own
// `delegator`, Main is the Hybrid's on-chain owner(), the agent is the delegation's
// `delegate`, and the MultiVault comes from the selected chain.
//
// Usage (from templates/):
//   node probe-value-lte-footgun.mjs [signed-delegation.json] --term 0x<termId> [--chain testnet|mainnet]

import { readFileSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ethers = (await import('ethers')).default ?? (await import('ethers'));
const req = createRequire(import.meta.url);
const core = req('./node_modules/@metamask/delegation-core/dist/index.cjs');
const { DELEGATION_MANAGER, resolveNetwork } = req('./networks.cjs');
const fs = await import('fs');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
// Positional args only — an option's VALUE must not be mistaken for a filename.
const VALUE_OPTS = ['--chain', '--term', '--rpc'];
const positionals = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith('--')) { if (VALUE_OPTS.includes(a)) i++; continue; }
  positionals.push(a);
}
const NET = resolveNetwork(opt('chain', 'testnet'));

const termOpt = opt('term', null);
if (!termOpt) {
  console.error('--term 0x<termId> is required: the probe deposits into a real vault, and a');
  console.error('hardcoded term would be wrong on the other network. Pass any existing vault.');
  process.exit(2);
}
const T = termOpt.replace(/^0x/, '').toLowerCase();
if (T.length !== 64) { console.error('--term must be 32 bytes of hex'); process.exit(2); }

const file = positionals[0] || path.join(__dirname, 'signed-delegation-final.json');
const DM = DELEGATION_MANAGER;
const provider = new ethers.JsonRpcProvider(NET.rpc);
const MULTIVAULT = NET.multivault;
const VALUE_LTE_ENFORCER = '0x92bf12322527caa612fd31a0e810472bbb106a8f';

const base = JSON.parse(fs.readFileSync(file, 'utf8'));
const d0 = base.delegation || base;
const HYBRID = d0.delegator;
const AGENT = d0.delegate;
const MAIN = await new ethers.Contract(HYBRID, ['function owner() view returns (address)'], provider).owner();

function encodeBytesArray(elements) {
  const N = elements.length;
  let head = N.toString(16).padStart(64, '0'), offsets = [], tailLen = 0;
  for (const el of elements) { offsets.push(32 * N + tailLen); tailLen += 32 + Math.ceil(el.length / 64) * 64; }
  head += offsets.map(o => o.toString(16).padStart(64, '0')).join('');
  let tail = '';
  for (const el of elements) {
    tail += (el.length / 2).toString(16).padStart(64, '0');
    tail += el.padEnd(Math.ceil(el.length / 64) * 64, '0');
  }
  return head + tail;
}

const value = ethers.parseEther('0.001');
const inner = '2fb1d270' + MAIN.toLowerCase().replace('0x', '').padStart(64, '0') + T.padStart(64, '0') + '1'.padStart(64, '0') + '0'.repeat(64);
const execution = MULTIVAULT.toLowerCase().replace('0x', '') + value.toString(16).padStart(64, '0') + inner;

function calldataFor(d) {
  const pc = core.encodeDelegations([d]);
  const ctx = encodeBytesArray([pc.slice(2)]);
  const modes = '0'.repeat(63) + '1' + '0'.repeat(64);
  const ex = encodeBytesArray([execution]);
  const o1 = 96, o2 = o1 + ctx.length / 2, o3 = o2 + modes.length / 2;
  return 'cef6d209' + [o1, o2, o3].map(o => o.toString(16).padStart(64, '0')).join('') + ctx + modes + ex;
}

async function sim(d, label) {
  try {
    await provider.call({ from: AGENT, to: DM, data: '0x' + calldataFor(d) });
    console.log(label.padEnd(46), '-> NO REVERT');
    return 'pass';
  } catch (e) {
    const msg = e.info?.error?.message || e.message || String(e);
    const named = msg.match(/Error\(string\): (\w+)/)?.[1] || msg.match(/0x[0-9a-f]{8}/)?.[0];
    console.log(label.padEnd(46), '->', named || msg.slice(0, 60));
    return named || msg.slice(0, 40);
  }
}

const variant = JSON.parse(JSON.stringify(base));
const cav = variant.caveats.find(c => c.enforcer.toLowerCase() === VALUE_LTE_ENFORCER);
if (!cav) { console.error('fixture has no ValueLte caveat — cannot run the falsifier'); process.exit(2); }
console.log(`chain ${NET.name} (${NET.chainId}) | Hybrid ${HYBRID} | agent ${AGENT} | main ${MAIN}`);
console.log('fixture ValueLte terms:', cav.terms);
console.log('');

const a = await sim(base, 'A) ValueLte = max  (2^255-1), deposit 0.001');
cav.terms = '0x' + '0'.repeat(64);
const b = await sim(variant, 'B) ValueLte = 0n                 , deposit 0.001');

console.log('');
if (a === 'pass' && b !== 'pass') {
  console.log('RESULT: FOOTGUN CONFIRMED — identical delegation, identical call,');
  console.log('        only ValueLte differs. valueLte=0n reverts value-bearing calls.');
  process.exit(0);
} else if (a === 'pass' && b === 'pass') {
  console.log('RESULT: FOOTGUN NOT REPRODUCED — ValueLte=0n did NOT block this deposit.');
  console.log('        Do not document it as a fact without a narrower reproducer.');
  process.exit(1);
} else {
  console.log('RESULT: INCONCLUSIVE — control A did not pass; the fixture/signature is stale.');
  process.exit(2);
}
