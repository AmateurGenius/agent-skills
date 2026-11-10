// verify-caveat-admission.mjs — does a caveat set ADMIT the deposit, independent of signature?
//
// Simulates redeemDelegations and reports WHERE each delegation fails:
//   NO REVERT  -> fully redeemable
//   0x155ff427 -> InvalidERC1271Signature: all enforcers PASSED, only the signature is wrong
//   0x08c379a0+Error(string):<Name> -> an ENFORCER rejected it (caveat problem)
//
// This separates "the caveats are wrong" from "the signature is wrong" — the two look
// identical from the page, where isValidSignature only covers the second.
//
// READ-ONLY: eth_call only.
//
// Nothing deployment-specific is hardcoded: each file's Hybrid is its own `delegator`,
// Main is that Hybrid's on-chain owner(), the agent is its `delegate`, and the MultiVault
// comes from the selected chain.
//
// Usage (from templates/):
//   node verify-caveat-admission.mjs <file.json> [file2.json …] --term 0x<termId> [--chain testnet|mainnet]
//
// Files that do not exist are skipped, so the probe still runs from a partial checkout.

import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ethers = (await import('ethers')).default ?? (await import('ethers'));
const req = createRequire(import.meta.url);
const core = req('./node_modules/@metamask/delegation-core/dist/index.cjs');
const { DELEGATION_MANAGER, resolveNetwork } = req('./networks.cjs');
const fs = await import('fs');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const NET = resolveNetwork(opt('chain', 'testnet'));
const DM = DELEGATION_MANAGER;
const provider = new ethers.JsonRpcProvider(NET.rpc);
const MULTIVAULT = NET.multivault;

const termOpt = opt('term', null);
if (!termOpt) {
  console.error('--term 0x<termId> is required: the probe deposits into a real vault, and a');
  console.error('hardcoded term would be wrong on the other network. Pass any existing vault.');
  process.exit(2);
}
const T = termOpt.replace(/^0x/, '').toLowerCase();
if (T.length !== 64) { console.error('--term must be 32 bytes of hex'); process.exit(2); }

// Positional args only — an option's VALUE must not be mistaken for a filename.
const VALUE_OPTS = ['--chain', '--term'];
const files = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith('--')) { if (VALUE_OPTS.includes(a)) i++; continue; }
  files.push(a);
}
if (!files.length) {
  console.error('usage: node verify-caveat-admission.mjs <file.json> [file2.json …] --term 0x<termId>');
  process.exit(2);
}

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

async function sim(file, label) {
  const abs = path.isAbsolute(file) ? file : path.join(__dirname, file);
  if (!existsSync(abs)) { console.log(label.padEnd(34), '-> SKIP (file not present)'); return; }
  const raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const d = raw.delegation || raw;
  const HYBRID = d.delegator;
  const AGENT = d.delegate;
  const MAIN = await new ethers.Contract(HYBRID, ['function owner() view returns (address)'], provider).owner();

  const value = ethers.parseEther('0.001');
  const inner = '2fb1d270' + MAIN.toLowerCase().replace('0x', '').padStart(64, '0') + T.padStart(64, '0') + '1'.padStart(64, '0') + '0'.repeat(64);
  const execution = MULTIVAULT.toLowerCase().replace('0x', '') + value.toString(16).padStart(64, '0') + inner;
  const pc = core.encodeDelegations([d]);
  const ctx = encodeBytesArray([pc.slice(2)]);
  const modes = '0'.repeat(63) + '1' + '0'.repeat(64);
  const ex = encodeBytesArray([execution]);
  const o1 = 96, o2 = o1 + ctx.length / 2, o3 = o2 + modes.length / 2;
  const calldata = 'cef6d209' + [o1, o2, o3].map(o => o.toString(16).padStart(64, '0')).join('') + ctx + modes + ex;
  try {
    await provider.call({ from: AGENT, to: DM, data: '0x' + calldata });
    console.log(label.padEnd(34), '-> NO REVERT ✓ (caveats admit deposit)');
  } catch (e) {
    const dt = e.info?.error?.data;
    const msg = e.info?.error?.message || e.message;
    const named = msg.match(/Error\(string\): (\w+)/)?.[1] || (dt ? String(dt).slice(0, 10) : '');
    console.log(label.padEnd(34), '->', named || msg.slice(0, 40));
  }
}

console.log(`chain ${NET.name} (${NET.chainId}) | term ${T}`);
for (const f of files) {
  const label = path.basename(f).replace(/\.json$/, '');
  await sim(f, label);
}
