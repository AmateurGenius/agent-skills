#!/usr/bin/env node
// provision-agent-wallet.cjs — make sure the agent has a delegate wallet.
//
// The delegate is the agent's OWN key: the delegator targets this address in the
// delegation, and the agent uses it to submit `redeemDelegations` transactions.
// Provision it ONCE, before the delegator builds the delegation.
//
// Order of preference:
//   1. Already provisioned — ~/.intuition/agent-wallet.json exists. Report and stop.
//   2. OWS available — `ows wallet create` (the mission-recommended stack). OWS keeps
//      the key encrypted at rest; the agent signs with `ows sign tx`.
//   3. Fallback — OWS unavailable: generate a local key at
//      ~/.intuition/agent-wallet.json (mode 0600). The executor signs directly with it.
//
// Prints the delegate address either way, plus which path is active.
//
// Usage:
//   node templates/provision-agent-wallet.cjs
//   node templates/provision-agent-wallet.cjs --ows-name intuition-agent
//   node templates/provision-agent-wallet.cjs --force     # regenerate (destroys the old key)
//
// The OWS branch follows the official README and falls through to the local-key path
// when `ows` is not installed or the create call fails.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ethers = require('ethers');

const HOME = process.env.HOME;
const KEY_FILE = path.join(HOME, '.intuition', 'agent-wallet.json');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const OWS_NAME = opt('ows-name', 'intuition-agent');
const FORCE = args.includes('--force');

function owsAvailable() {
  try { execFileSync('ows', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] }); return true; }
  catch { return false; }
}

// `ows wallet create` prints a table whose EVM row is `eip155:<chain> 0x… <path>`.
// The EVM address is the same across eip155 chains (one seed, one derivation path).
function owsCreate(name) {
  const out = execFileSync('ows', ['wallet', 'create', '--name', name], { encoding: 'utf8' });
  const m = out.match(/eip155:\S+\s+(0x[0-9a-fA-F]{40})/);
  if (!m) throw new Error('no eip155 address in the ows output:\n' + out.slice(0, 400));
  return m[1];
}

function localKey() {
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true, mode: 0o700 });
  const w = ethers.Wallet.createRandom();
  fs.writeFileSync(KEY_FILE, JSON.stringify({ address: w.address, privateKey: w.privateKey }, null, 2), { mode: 0o600 });
  return w.address;
}

function report(obj) { console.log(JSON.stringify(obj, null, 2)); }

function main() {
  if (fs.existsSync(KEY_FILE) && !FORCE) {
    const j = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
    report({
      provisioned: true, path: 'local-key', delegate: j.address, keyFile: KEY_FILE,
      note: 'already provisioned; not overwritten. Use --force to regenerate (the old key is destroyed).',
    });
    return;
  }

  if (owsAvailable()) {
    try {
      const address = owsCreate(OWS_NAME);
      report({
        provisioned: true, path: 'ows', delegate: address, owsName: OWS_NAME,
        note: 'Key is held by OWS and never exported. Sign redemptions with: '
            + `ows sign tx --wallet ${OWS_NAME} --chain <chainId> --tx <raw-tx-hex>`,
      });
      return;
    } catch (e) {
      console.error('OWS wallet create failed: ' + e.message);
      console.error('Falling back to a local key file.');
    }
  } else {
    console.error('OWS CLI not available on this platform — using the local key fallback.');
  }

  const address = localKey();
  report({
    provisioned: true, path: 'local-key', delegate: address, keyFile: KEY_FILE,
    note: 'Local key fallback (no OWS build for this platform). '
        + 'templates/redeem-delegation.cjs signs directly with this key.',
  });
}

main();
