#!/usr/bin/env node

import {
  PlanError,
  errorPayload,
  loadRegistry,
  printJson,
  registryTermDescriptor,
  registryTermKeys,
} from './partner-plan.mjs'

function parseArgs(argv) {
  const args = { network: 'all', pretty: true }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--network') args.network = argv[++index]
    else if (arg === '--registry') throw new PlanError('registry_override_forbidden', 'Live verification uses only the bundled registry')
    else if (arg === '--compact') args.pretty = false
    else if (arg === '--help' || arg === '-h') args.help = true
    else throw new PlanError('unknown_argument', `Unknown argument: ${arg}`)
  }
  if (!['mainnet', 'testnet', 'all'].includes(args.network)) {
    throw new PlanError('invalid_network', '--network must be mainnet, testnet, or all')
  }
  return args
}

async function verifyNetwork(registry, network) {
  const config = registry.networks[network]
  const expected = registryTermKeys(registry).map((key) => registryTermDescriptor(registry, network, key))
  const expectedIds = [...new Set(expected.map((entry) => entry.termId))]
  const response = await fetch(config.graphql, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      query: `query VerifyERC8004Registry($ids: [String!]!) {
  atoms(where: { term_id: { _in: $ids } }) {
    term_id
    label
    data
  }
}`,
      variables: { ids: expectedIds },
    }),
  })
  if (!response.ok) {
    throw new PlanError('graphql_http_error', `${network} registry verification returned HTTP ${response.status}`)
  }
  const payload = await response.json()
  if (payload.errors?.length) {
    throw new PlanError('graphql_error', `${network} registry verification returned GraphQL errors`, payload.errors)
  }
  const atoms = payload.data?.atoms ?? []
  const byId = new Map(atoms.map((atom) => [atom.term_id, atom]))
  const checks = expected.map((entry) => {
    const actual = byId.get(entry.termId)
    const errors = []
    if (!actual) errors.push('missing term ID')
    if (actual && entry.verifyLabel && !entry.acceptedIndexerLabels.includes(actual.label)) {
      errors.push(`label mismatch: expected one of ${entry.acceptedIndexerLabels.join(', ')}, got ${actual.label}`)
    }
    if (actual && entry.atomData && actual.data !== entry.atomData) errors.push(`atom data mismatch: expected ${entry.atomData}, got ${actual.data}`)
    return {
      key: entry.key,
      label: entry.label,
      termId: entry.termId,
      ...(entry.atomData ? { atomData: entry.atomData } : {}),
      ...(actual?.label !== entry.label ? { indexedLabel: actual?.label } : {}),
      found: Boolean(actual),
      valid: errors.length === 0,
      errors,
    }
  })
  return {
    network,
    endpoint: config.graphql,
    expected: expected.length,
    expectedUnique: expectedIds.length,
    found: atoms.length,
    valid: checks.every((entry) => entry.valid),
    checks,
  }
}

function usage() {
  return `Verify the bundled ERC-8004 registry against live Intuition GraphQL.

Usage:
  node verify-registry.mjs [--network mainnet|testnet|all] [--compact]

This command is read-only and never pins, signs, or broadcasts.`
}

try {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    process.stdout.write(`${usage()}\n`)
    process.exit(0)
  }
  const { registry, sha256 } = await loadRegistry()
  const networks = args.network === 'all' ? ['mainnet', 'testnet'] : [args.network]
  const results = await Promise.all(networks.map((network) => verifyNetwork(registry, network)))
  const valid = results.every((result) => result.valid)
  printJson({
    status: valid ? 'valid' : 'invalid',
    valid,
    registry: registry.registry,
    version: registry.version,
    sha256,
    results,
  }, args.pretty)
  if (!valid) process.exit(1)
} catch (error) {
  printJson(errorPayload(error), true, process.stderr)
  process.exit(1)
}
