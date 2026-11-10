// networks.cjs — the single source of truth for Intuition chain data in templates/.
//
// Every script and probe in this directory resolves its network through here, so no
// tool hardcodes one chain or one deployment. The MultiVault and the Hybrid are
// chain-specific; Main and the agent are plain addresses that are the same on both.
//
// Usage:
//   const { resolveNetwork, DELEGATION_MANAGER } = require('./networks.cjs');
//   const NET = resolveNetwork('testnet');      // throws on an unknown name
//
// Overridable for local forks by editing this file — not by editing every script.

const NETWORKS = {
  testnet: {
    chainId: 13579,
    name: 'Intuition Testnet',
    rpc: 'https://testnet.rpc.intuition.systems/http',
    multivault: '0x2Ece8D4dEdcB9918A398528f3fa4688b1d2CAB91',
  },
  mainnet: {
    chainId: 1155,
    name: 'Intuition Mainnet',
    rpc: 'https://rpc.intuition.systems/http',
    multivault: '0x6E35cF57A41fA15eA0EaE9C33e751b01A784Fe7e',
  },
};

// Same address on both chains.
const DELEGATION_MANAGER = '0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3';
const ENTRY_POINT = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';   // canonical ERC-4337 v0.7

/** Resolve a network name, or throw a message the caller can print and exit on. */
function resolveNetwork(name) {
  const net = NETWORKS[name];
  if (!net) throw new Error(`unknown chain "${name}" — use ${Object.keys(NETWORKS).join(' or ')}`);
  return net;
}

/** Parse `--chain <name>` from an argv array (default testnet). */
function parseChainArg(argv) {
  const i = argv.indexOf('--chain');
  return i >= 0 ? argv[i + 1] : 'testnet';
}

module.exports = { NETWORKS, DELEGATION_MANAGER, ENTRY_POINT, resolveNetwork, parseChainArg };
