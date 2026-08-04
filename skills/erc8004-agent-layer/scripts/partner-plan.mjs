import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const HEX_32 = /^0x[0-9a-fA-F]{64}$/
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/
const DECIMAL_ID = /^(0|[1-9][0-9]*)$/
const MAX_PREFLIGHT_AGE_MS = 24 * 60 * 60 * 1000
const BUNDLED_REGISTRY_BYTES_SHA256 = '0a519072deda77c5159320ec359b2c77bf27982c2e0048bc078204a68fb0219a'
const BUNDLED_REGISTRY_CONTENT_SHA256 = '406f7baf0b0083d242e864319c3b19c7e7fbcef692287e415d2a2b5fd3f1f347'
const THING_KEYS = new Set(['name', 'description', 'image', 'url'])
const ALLOWED_CREATION_REFS = new Set(['agent', 'identityObject', 'provider', 'assessmentSource', 'owner'])
const PROTOCOL_ORDER = ['mcp', 'a2a', 'oasf']
const ASSESSMENT_SEMANTICS = 'The provider publishes trust or risk data about the agent; this is discovery, not endorsement.'
const PLAN_ARTIFACT = {
  type: 'erc8004-semantic-plan',
  producer: 'build-partner-plan.mjs',
  policy: 'canonical-output-only',
}
const BLOCKED_ACTIONS = [
  'pin-partner-entities',
  'resolve-or-mint-atoms',
  'query-write-costs',
  'prepare-unsigned-calldata',
  'sign-transactions',
  'broadcast-transactions',
]

const TRUST_TRIPLES = [
  ['trust-provider', 'agent', 'predicate:has-trust-provider', 'provider'],
  ['trust-assessment', 'agent', 'predicate:has-trust-assessment', 'assessmentSource'],
  ['assessment-provider', 'assessmentSource', 'predicate:provided-by', 'provider'],
  ['assessment-type', 'assessmentSource', 'predicate:has-type', 'type:trust-assessment-source'],
]

const IDENTITY_TRIPLES = [
  ['identity-anchor', 'agent', 'predicate:same-as', 'identityObject'],
  ['agent-type', 'agent', 'predicate:has-type', 'type:ai-agent'],
  ['agent-standard', 'agent', 'predicate:implement', 'standard:erc-8004'],
]

export class PlanError extends Error {
  constructor(code, message, details = undefined) {
    super(message)
    this.name = 'PlanError'
    this.code = code
    this.details = details
  }
}

function invariant(condition, code, message, details) {
  if (!condition) throw new PlanError(code, message, details)
}

export async function loadRegistry() {
  const registryPath = defaultRegistryPath()
  const bytes = await readFile(registryPath)
  const registry = JSON.parse(bytes.toString('utf8'))
  const bundle = {
    registry,
    registryPath,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
  assertBundledRegistryBundle(bundle)
  return bundle
}

export function defaultRegistryPath() {
  return fileURLToPath(new URL('../reference/registry.json', import.meta.url))
}

function assertBundledRegistryBundle(bundle) {
  const contentSha256 = bundle?.registry && typeof bundle.registry === 'object'
    ? createHash('sha256').update(stableStringify(bundle.registry)).digest('hex')
    : null
  invariant(
    bundle?.registryPath === defaultRegistryPath() &&
      bundle?.sha256 === BUNDLED_REGISTRY_BYTES_SHA256 &&
      contentSha256 === BUNDLED_REGISTRY_CONTENT_SHA256,
    'registry_bundle_mismatch',
    'Only the pinned bundled ERC-8004 registry is accepted; update the registry and its reviewed digests together',
  )
}

function assertHex32(value, path) {
  invariant(typeof value === 'string' && HEX_32.test(value), 'invalid_term_id', `${path} must be a 32-byte 0x-prefixed term ID`)
}

function assertOnlyKeys(value, allowedKeys, path) {
  invariant(value && typeof value === 'object' && !Array.isArray(value), 'invalid_input', `${path} must be an object`)
  const unknownFields = Object.keys(value).filter((key) => !allowedKeys.includes(key))
  invariant(
    unknownFields.length === 0,
    'unknown_manifest_field',
    `${path} contains unsupported fields: ${unknownFields.join(', ')}`,
    { path, unknownFields },
  )
}

function assertHttpsUrl(value, path) {
  invariant(typeof value === 'string' && value.length > 0, 'invalid_url', `${path} must be a non-empty URL`)
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new PlanError('invalid_url', `${path} must be a valid URL`)
  }
  invariant(parsed.protocol === 'https:', 'https_required', `${path} must use https`)
  invariant(!parsed.username && !parsed.password, 'url_credentials_forbidden', `${path} must not contain URL credentials`)
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  invariant(!isPrivateHostname(hostname), 'private_url_forbidden', `${path} must not target a private, loopback, link-local, or local hostname`)
}

function isPrivateHostname(hostname) {
  if (!hostname) return true
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) return true
  if (hostname === '::1' || hostname === '::' || hostname.startsWith('fe8') || hostname.startsWith('fe9') || hostname.startsWith('fea') || hostname.startsWith('feb')) return true
  if (hostname.startsWith('fc') || hostname.startsWith('fd')) return true
  const mappedIpv4 = hostname.match(/^(?:::(?:ffff:)?|(?:0:){5}ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (mappedIpv4) {
    const high = Number.parseInt(mappedIpv4[1], 16)
    const low = Number.parseInt(mappedIpv4[2], 16)
    const ipv4 = `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`
    return isPrivateHostname(ipv4)
  }
  const parts = hostname.split('.')
  if (parts.length !== 4 || !parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255)) return false
  const [a, b] = parts.map(Number)
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
}

function assertThing(thing, path) {
  invariant(thing && typeof thing === 'object' && !Array.isArray(thing), 'invalid_thing', `${path} must be a pinThing object`)
  const keys = Object.keys(thing)
  invariant(keys.every((key) => THING_KEYS.has(key)), 'invalid_thing_field', `${path} may contain only name, description, image, and url`, { keys })
  const missingFields = [...THING_KEYS].filter((key) => typeof thing[key] !== 'string')
  invariant(
    missingFields.length === 0,
    'missing_thing_fields',
    `${path} must include string fields: ${missingFields.join(', ')}`,
    { missingFields },
  )
  invariant(thing.name.trim().length > 0, 'invalid_thing', `${path}.name must not be empty`)
  invariant(thing.description.trim().length > 0, 'invalid_thing', `${path}.description must not be empty`)
  if (thing.url) assertHttpsUrl(thing.url, `${path}.url`)
}

function assertEntity(entity, path, { requireResolver = false, forbiddenAtomIds = new Set() } = {}) {
  invariant(entity && typeof entity === 'object' && !Array.isArray(entity), 'invalid_entity', `${path} is required`)
  const hasAtomId = entity.atomId !== undefined
  const hasThing = entity.thing !== undefined
  invariant(hasAtomId !== hasThing, 'ambiguous_entity', `${path} must provide exactly one of atomId or thing`)
  if (hasAtomId) {
    assertHex32(entity.atomId, `${path}.atomId`)
    invariant(
      !forbiddenAtomIds.has(entity.atomId),
      'registry_term_as_entity_forbidden',
      `${path}.atomId is a controlled registry term and cannot be used as an entity ID`,
    )
  }
  if (hasThing) assertThing(entity.thing, `${path}.thing`)
  if (requireResolver) {
    assertHttpsUrl(entity.resolverUrl, `${path}.resolverUrl`)
    if (hasThing) {
      invariant(entity.thing.url === entity.resolverUrl, 'resolver_url_mismatch', `${path}.thing.url must equal ${path}.resolverUrl`)
    }
  }
}

function normalizeText(value) {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function registryEntry(registry, key) {
  if (registry.terms[key]) return registry.terms[key]
  for (const [catalogName, prefix] of [['oasfSkills', 'oasf-skill:'], ['oasfDomains', 'oasf-domain:']]) {
    if (!key.startsWith(prefix)) continue
    const catalog = registry.catalogs?.[catalogName]
    const label = key.slice(prefix.length)
    const termId = catalog?.entries?.[label]
    if (!termId) return null
    return {
      label,
      kind: catalog.kind,
      createPolicy: catalog.createPolicy,
      selection: catalog.selection,
      verifyLabel: false,
      termIds: { mainnet: termId, testnet: termId },
    }
  }
  return null
}

export function registryTermKeys(registry) {
  return [
    ...Object.keys(registry.terms),
    ...Object.keys(registry.catalogs?.oasfSkills?.entries ?? {}).map((label) => `oasf-skill:${label}`),
    ...Object.keys(registry.catalogs?.oasfDomains?.entries ?? {}).map((label) => `oasf-domain:${label}`),
  ]
}

export function registryTermDescriptor(registry, network, key) {
  const entry = registryEntry(registry, key)
  invariant(entry, 'registry_term_missing', `Registry term ${key} is missing`)
  invariant(entry.createPolicy === 'resolve-only', 'unsafe_registry_policy', `Registry term ${key} must be resolve-only`)
  invariant(entry.selection === 'term-id-only', 'unsafe_registry_selection', `Registry term ${key} must be selected by term ID`)
  const termId = entry.termIds?.[network]
  assertHex32(termId, `registry term ${key} on ${network}`)
  return {
    key,
    label: entry.label,
    kind: entry.kind,
    termId,
    createPolicy: entry.createPolicy,
    atomData: entry.atomData,
    verifyLabel: entry.verifyLabel !== false,
    acceptedIndexerLabels: entry.acceptedIndexerLabels?.[network] ?? [entry.label],
  }
}

function term(registry, network, key) {
  const { label, kind, termId, createPolicy } = registryTermDescriptor(registry, network, key)
  return { key, label, kind, termId, createPolicy }
}

function hasRegistryTerm(registry, key) {
  return registryEntry(registry, key) !== null
}

function entityPosition(ref, termId = null) {
  return { source: 'entity', ref, termId }
}

function registryPosition(registry, network, key) {
  const value = term(registry, network, key)
  return { source: 'registry', key, label: value.label, termId: value.termId }
}

function makeTriple(registry, network, [key, subject, predicate, object], entityIds) {
  const subjectPosition = hasRegistryTerm(registry, subject)
    ? registryPosition(registry, network, subject)
    : entityPosition(subject, entityIds[subject] ?? null)
  const objectPosition = hasRegistryTerm(registry, object)
    ? registryPosition(registry, network, object)
    : entityPosition(object, entityIds[object] ?? null)
  return {
    key,
    subject: subjectPosition,
    predicate: registryPosition(registry, network, predicate),
    object: objectPosition,
    createIfMissing: true,
  }
}

function registryKeysForDefinitions(registry, definitions) {
  const keys = new Set(['predicate:same-as'])
  for (const [, subject, predicate, object] of definitions) {
    for (const position of [subject, predicate, object]) {
      if (hasRegistryTerm(registry, position)) keys.add(position)
    }
  }
  return [...keys]
}

export function preflightQuery(registry, network, caipId) {
  return {
    operationName: 'FindAgentByERC8004Identity',
    endpoint: registry.networks[network].graphql,
    query: `query FindAgentByERC8004Identity($sameAsPredicateId: String!, $caipId: String!) {
  triples(
    where: {
      predicate_id: { _eq: $sameAsPredicateId }
      object: { value: { thing: { name: { _eq: $caipId } } } }
    }
    limit: 2
  ) {
    term_id
    subject { term_id value { thing { name description image url } } }
    predicate { term_id }
    object { term_id value { thing { name description image url } } }
  }
}`,
    variables: {
      sameAsPredicateId: term(registry, network, 'predicate:same-as').termId,
      caipId,
    },
    interpretation: {
      zeroMatches: 'Record status=not_found and use the exact agent recipe.',
      oneMatch: 'Record status=found and reuse subject.term_id.',
      multipleMatches: 'Record status=ambiguous and stop for manual resolution.',
    },
  }
}

async function fetchPreflightWithRetry(fetchImpl, url, init, {
  retryDelaysMs = [0, 250, 750],
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
} = {}) {
  let lastError
  let lastResponse
  for (const [index, delayMs] of retryDelaysMs.entries()) {
    if (index > 0 && delayMs > 0) await sleep(delayMs)
    try {
      const response = await fetchImpl(url, init)
      if (response?.ok || (response?.status !== 429 && response?.status < 500)) return response
      lastResponse = response
    } catch (error) {
      lastError = error
    }
  }
  if (lastResponse) return lastResponse
  throw lastError ?? new PlanError('preflight_network_error', 'Agent preflight request failed')
}

function queryDigest(query) {
  return createHash('sha256').update(stableStringify({ query: query.query, variables: query.variables })).digest('hex')
}

function preflightState(preflight, networkConfig, query, identityObjectDescription) {
  if (!preflight) return { status: 'preflight_required', reason: 'missing' }
  invariant(preflight.source === 'live-query', 'untrusted_preflight', 'semantic-plan-ready plans require preflight evidence produced by the live query helper')
  invariant(['found', 'not_found', 'ambiguous'].includes(preflight.status), 'invalid_preflight', 'agent.preflight.status must be found, not_found, or ambiguous')
  invariant(preflight.graphqlEndpoint === networkConfig.graphql, 'wrong_preflight_endpoint', 'agent preflight must use the selected network GraphQL endpoint')
  invariant(Number.isInteger(preflight.matchCount) && preflight.matchCount >= 0, 'invalid_preflight', 'agent.preflight.matchCount must be a non-negative integer')
  const checkedAt = Date.parse(preflight.checkedAt)
  invariant(Number.isFinite(checkedAt), 'invalid_preflight_time', 'agent.preflight.checkedAt must be an ISO-8601 timestamp')
  const age = Date.now() - checkedAt
  if (age < -5 * 60 * 1000 || age > MAX_PREFLIGHT_AGE_MS) {
    return { status: 'preflight_required', reason: 'stale', previous: preflight }
  }
  invariant(preflight.querySha256 === queryDigest(query), 'preflight_query_mismatch', 'preflight evidence does not match the canonical query')
  invariant(typeof preflight.responseSha256 === 'string' && /^[0-9a-f]{64}$/.test(preflight.responseSha256), 'invalid_preflight_digest', 'preflight response digest is required')
  invariant(Array.isArray(preflight.rows) && preflight.rows.length === preflight.matchCount, 'invalid_preflight_rows', 'preflight evidence rows must match matchCount')
  invariant(preflight.responseSha256 === createHash('sha256').update(stableStringify(preflight.rows)).digest('hex'), 'preflight_response_mismatch', 'preflight evidence rows do not match the response digest')
  for (const [index, row] of preflight.rows.entries()) {
    assertHex32(row?.sameAsTripleId, `agent.preflight.rows[${index}].sameAsTripleId`)
    assertHex32(row?.agentAtomId, `agent.preflight.rows[${index}].agentAtomId`)
    assertHex32(row?.identityObjectId, `agent.preflight.rows[${index}].identityObjectId`)
    invariant(row?.predicateId === query.variables.sameAsPredicateId, 'preflight_tuple_mismatch', 'preflight row predicate ID is not canonical same as')
    invariant(row?.identityName === query.variables.caipId, 'preflight_tuple_mismatch', 'preflight row identity name does not match the requested CAIP identity')
    assertThing(row?.agentThing, `agent.preflight.rows[${index}].agentThing`)
    invariant(
      JSON.stringify(row?.identityThing) === JSON.stringify({
        name: query.variables.caipId,
        description: identityObjectDescription,
        image: '',
        url: '',
      }),
      'preflight_tuple_mismatch',
      'preflight row identity object does not match the canonical CAIP Thing recipe',
    )
  }
  if (preflight.status === 'ambiguous' || preflight.matchCount > 1) {
    return { status: 'manual_resolution_required', reason: 'ambiguous', previous: preflight }
  }
  if (preflight.status === 'found') {
    invariant(preflight.matchCount === 1, 'invalid_preflight', 'found preflight must have matchCount=1')
    assertHex32(preflight.agentAtomId, 'agent.preflight.agentAtomId')
    assertHex32(preflight.sameAsTripleId, 'agent.preflight.sameAsTripleId')
    invariant(preflight.rows[0]?.agentAtomId === preflight.agentAtomId && preflight.rows[0]?.sameAsTripleId === preflight.sameAsTripleId, 'preflight_tuple_mismatch', 'preflight found IDs must match the retained response tuple')
  } else {
    invariant(preflight.matchCount === 0, 'invalid_preflight', 'not_found preflight must have matchCount=0')
  }
  return { status: 'semantic_plan_ready', preflight }
}

function registryExtensionRequired(field, value) {
  throw new PlanError(
    'registry_extension_required',
    `${field} value ${value} is not in the bundled canonical registry; request a registry-maintainer extension instead of minting vocabulary`,
    { field, value },
  )
}

function normalizeCatalogValues(value, field, registry, prefix) {
  invariant(Array.isArray(value), 'invalid_enrichment', `${field} must be an array`)
  const requested = [...new Set(value.map((entry) => {
    invariant(typeof entry === 'string' && entry.trim().length > 0, 'invalid_enrichment', `${field} entries must be non-empty strings`)
    return entry.trim()
  }))].sort()
  const normalized = []
  const seenTermIds = new Set()
  for (const entry of requested) {
    if (!hasRegistryTerm(registry, `${prefix}${entry}`)) registryExtensionRequired(field, entry)
    const termId = registryEntry(registry, `${prefix}${entry}`).termIds.mainnet
    if (seenTermIds.has(termId)) continue
    seenTermIds.add(termId)
    normalized.push(entry)
  }
  return normalized
}

function normalizeEnrichment(value, registry, chainId) {
  const empty = {
    includeRegistrationChain: false,
    owner: null,
    protocols: [],
    x402: false,
    trustModels: [],
    oasfSkills: [],
    oasfDomains: [],
  }
  if (value === undefined) return empty
  assertOnlyKeys(value, Object.keys(empty), 'manifest.enrichment')
  invariant(typeof value.includeRegistrationChain === 'boolean', 'invalid_enrichment', 'enrichment.includeRegistrationChain must be a boolean')
  invariant(value.owner === null || typeof value.owner === 'string', 'invalid_enrichment', 'enrichment.owner must be an EVM address string or null')
  invariant(Array.isArray(value.protocols), 'invalid_enrichment', 'enrichment.protocols must be an array')
  invariant(typeof value.x402 === 'boolean', 'invalid_enrichment', 'enrichment.x402 must be a boolean')

  const owner = value.owner === null ? null : value.owner.toLowerCase()
  invariant(owner === null || EVM_ADDRESS.test(owner), 'invalid_owner', 'enrichment.owner must be a 20-byte 0x-prefixed EVM address')
  const requestedProtocols = new Set(value.protocols.map((entry) => {
    invariant(typeof entry === 'string', 'invalid_enrichment', 'enrichment.protocols entries must be strings')
    return entry.trim().toLowerCase()
  }))
  for (const protocol of requestedProtocols) {
    invariant(PROTOCOL_ORDER.includes(protocol), 'invalid_enrichment', `Unsupported enrichment protocol: ${protocol}`)
  }
  const protocols = PROTOCOL_ORDER.filter((protocol) => requestedProtocols.has(protocol))
  const trustModels = normalizeCatalogValues(value.trustModels, 'enrichment.trustModels', registry, 'trust-model:')
  const oasfSkills = normalizeCatalogValues(value.oasfSkills, 'enrichment.oasfSkills', registry, 'oasf-skill:')
  const oasfDomains = normalizeCatalogValues(value.oasfDomains, 'enrichment.oasfDomains', registry, 'oasf-domain:')

  if (value.includeRegistrationChain) {
    const chainKey = registry.erc8004.chainTermKeysByEvmChainId?.[String(chainId)]
    if (!chainKey || !hasRegistryTerm(registry, chainKey)) {
      registryExtensionRequired('enrichment.includeRegistrationChain', String(chainId))
    }
  }

  return {
    includeRegistrationChain: value.includeRegistrationChain,
    owner,
    protocols,
    x402: value.x402,
    trustModels,
    oasfSkills,
    oasfDomains,
  }
}

function enrichmentDefinitions(registry, chainId, enrichment) {
  const definitions = []
  if (enrichment.includeRegistrationChain) {
    definitions.push(['enrichment-chain', 'agent', 'predicate:available-on', registry.erc8004.chainTermKeysByEvmChainId[String(chainId)]])
  }
  if (enrichment.owner) definitions.push(['enrichment-owner', 'agent', 'predicate:created-by', 'owner'])
  if (enrichment.protocols.includes('mcp')) {
    definitions.push(['enrichment-type-mcp', 'agent', 'predicate:has-type', 'type:mcp-server'])
    definitions.push(['enrichment-use-mcp', 'agent', 'predicate:use', 'standard:mcp'])
  }
  if (enrichment.protocols.includes('a2a')) {
    definitions.push(['enrichment-type-a2a', 'agent', 'predicate:has-type', 'type:a2a-agent'])
    definitions.push(['enrichment-use-a2a', 'agent', 'predicate:use', 'standard:a2a'])
  }
  if (enrichment.protocols.includes('oasf')) {
    definitions.push(['enrichment-use-oasf', 'agent', 'predicate:use', 'standard:oasf'])
  }
  if (enrichment.x402) {
    definitions.push(['enrichment-tag-x402', 'agent', 'predicate:has-tag', 'standard:x402'])
    definitions.push(['enrichment-compatible-x402', 'agent', 'predicate:compatible-with', 'standard:x402'])
  }
  for (const trustModel of enrichment.trustModels) {
    definitions.push([`enrichment-trust-model:${trustModel}`, 'agent', 'predicate:has-tag', `trust-model:${trustModel}`])
  }
  for (const skill of enrichment.oasfSkills) {
    definitions.push([`enrichment-oasf-skill:${skill}`, 'agent', 'predicate:has-tag', `oasf-skill:${skill}`])
  }
  for (const domain of enrichment.oasfDomains) {
    definitions.push([`enrichment-oasf-domain:${domain}`, 'agent', 'predicate:has-category', `oasf-domain:${domain}`])
  }
  return definitions
}

function identityContext(input, registry) {
  invariant(input && typeof input === 'object' && !Array.isArray(input), 'invalid_input', 'Input must be a JSON object')
  assertOnlyKeys(input, ['schemaVersion', 'network', 'agent', 'provider', 'assessmentSource', 'enrichment'], 'manifest')
  invariant(input.schemaVersion === 1, 'unsupported_schema', 'schemaVersion must be 1')
  const network = input.network
  invariant(network === 'mainnet' || network === 'testnet', 'invalid_network', 'network must be mainnet or testnet')
  invariant(input.agent && typeof input.agent === 'object', 'agent_required', 'agent is required')
  invariant(input.agent.preflight === undefined, 'manifest_preflight_forbidden', 'Do not place preflight claims in the manifest; the planner obtains live evidence')
  assertOnlyKeys(input.agent, ['chainId', 'tokenId', 'registrationFile'], 'manifest.agent')
  if (input.agent.registrationFile !== undefined) {
    assertOnlyKeys(input.agent.registrationFile, ['name', 'description', 'image', 'webEndpoint'], 'manifest.agent.registrationFile')
  }
  if (input.provider !== undefined) assertOnlyKeys(input.provider, ['atomId', 'thing'], 'manifest.provider')
  if (input.assessmentSource !== undefined) {
    assertOnlyKeys(input.assessmentSource, ['atomId', 'thing', 'resolverUrl'], 'manifest.assessmentSource')
  }
  if (input.enrichment !== undefined) {
    assertOnlyKeys(input.enrichment, [
      'includeRegistrationChain', 'owner', 'protocols', 'x402',
      'trustModels', 'oasfSkills', 'oasfDomains',
    ], 'manifest.enrichment')
  }
  const chainId = input.agent.chainId
  const rawTokenId = input.agent.tokenId
  invariant(
    typeof rawTokenId === 'string' || Number.isSafeInteger(rawTokenId),
    'invalid_erc8004_token',
    'agent.tokenId must be a base-10 string or a non-negative safe integer; use a string for large token IDs',
  )
  const tokenId = String(rawTokenId)
  invariant(Number.isSafeInteger(chainId) && chainId > 0, 'invalid_erc8004_chain', 'agent.chainId must be a positive safe integer')
  invariant(DECIMAL_ID.test(tokenId), 'invalid_erc8004_token', 'agent.tokenId must be a base-10 non-negative integer string')
  const caipId = `eip155:${chainId}/erc721:${registry.erc8004.identityRegistry}/${tokenId}`
  return { network, chainId, tokenId, caipId, networkConfig: registry.networks[network] }
}

export async function resolveAgentPreflight(input, registryBundle, {
  fetchImpl = fetch,
  now = () => new Date(),
  retryDelaysMs,
  sleep,
} = {}) {
  assertBundledRegistryBundle(registryBundle)
  const { registry } = registryBundle
  const { network, caipId, networkConfig } = identityContext(input, registry)
  const query = preflightQuery(registry, network, caipId)
  const response = await fetchPreflightWithRetry(fetchImpl, networkConfig.graphql, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ query: query.query, variables: query.variables }),
    redirect: 'error',
  }, { retryDelaysMs, sleep })
  invariant(response?.ok, 'preflight_http_error', `Agent preflight returned HTTP ${response?.status ?? 'unknown'}`)
  const payload = await response.json()
  invariant(!payload.errors?.length, 'preflight_graphql_error', 'Agent preflight returned GraphQL errors', payload.errors)
  const rows = payload.data?.triples
  invariant(Array.isArray(rows), 'invalid_preflight_response', 'Agent preflight response is missing data.triples')
  invariant(rows.length <= 2, 'invalid_preflight_response', 'Agent preflight returned more rows than requested')
  const sameAsId = query.variables.sameAsPredicateId
  const expectedIdentityThing = {
    name: caipId,
    description: registry.erc8004.identityObjectDescription,
    image: '',
    url: '',
  }
  for (const [index, row] of rows.entries()) {
    assertHex32(row?.term_id, `preflight.rows[${index}].term_id`)
    assertHex32(row?.subject?.term_id, `preflight.rows[${index}].subject.term_id`)
    invariant(row?.predicate?.term_id === sameAsId, 'invalid_preflight_response', 'Preflight row predicate does not match canonical same as')
    try {
      assertThing(row?.subject?.value?.thing, `preflight.rows[${index}].subject.value.thing`)
    } catch (error) {
      throw new PlanError('invalid_preflight_response', `Preflight subject must be a pinThing agent atom: ${error.message}`)
    }
    invariant(
      JSON.stringify(row?.object?.value?.thing) === JSON.stringify(expectedIdentityThing),
      'invalid_preflight_response',
      'Preflight object does not match the canonical ERC-8004 CAIP identity Thing',
    )
  }
  const base = {
    source: 'live-query',
    status: rows.length === 0 ? 'not_found' : rows.length === 1 ? 'found' : 'ambiguous',
    matchCount: rows.length,
    checkedAt: now().toISOString(),
    graphqlEndpoint: networkConfig.graphql,
    querySha256: queryDigest(query),
    rows: rows.map((row) => ({
      sameAsTripleId: row.term_id,
      agentAtomId: row.subject.term_id,
      predicateId: row.predicate.term_id,
      identityObjectId: row.object.term_id,
      identityName: row.object.value.thing.name,
      agentThing: row.subject.value.thing,
      identityThing: row.object.value.thing,
    })),
  }
  base.responseSha256 = createHash('sha256').update(stableStringify(base.rows)).digest('hex')
  if (rows.length === 1) {
    return {
      ...base,
      agentAtomId: rows[0].subject.term_id,
      sameAsTripleId: rows[0].term_id,
    }
  }
  return base
}

function comparablePreflightEvidence(evidence) {
  return {
    source: evidence?.source,
    status: evidence?.status,
    matchCount: evidence?.matchCount,
    graphqlEndpoint: evidence?.graphqlEndpoint,
    querySha256: evidence?.querySha256,
    rows: evidence?.rows,
    responseSha256: evidence?.responseSha256,
    ...(evidence?.status === 'found' ? {
      agentAtomId: evidence?.agentAtomId,
      sameAsTripleId: evidence?.sameAsTripleId,
    } : {}),
  }
}

export async function revalidatePlanPreflight(plan, registryBundle, options = {}) {
  assertBundledRegistryBundle(registryBundle)
  if (plan?.status !== 'semantic_plan_ready') {
    return { valid: true, errors: [], skipped: true, reason: 'semantic-plan-is-not-ready' }
  }
  const liveEvidence = await resolveAgentPreflight({
    schemaVersion: 1,
    network: plan.network,
    agent: {
      chainId: plan.identity?.chainId,
      tokenId: plan.identity?.tokenId,
    },
  }, registryBundle, options)
  const matches = stableStringify(comparablePreflightEvidence(plan.preflightEvidence)) ===
    stableStringify(comparablePreflightEvidence(liveEvidence))
  return {
    valid: matches,
    errors: matches ? [] : ['plan preflight evidence no longer matches a fresh canonical identity query'],
    skipped: false,
    checkedAt: liveEvidence.checkedAt,
    status: liveEvidence.status,
    matchCount: liveEvidence.matchCount,
  }
}

function agentRecipe(registry, chainId, tokenId, registrationFile) {
  invariant(registrationFile && typeof registrationFile === 'object', 'registration_required', 'agent.registrationFile is required after a not_found preflight')
  const agentKey = `${chainId}:${tokenId}`
  const fallbackUrl = registry.erc8004.agentFallbackUrlTemplate
    .replace('{chainId}', String(chainId))
    .replace('{tokenId}', tokenId)
  const thing = {
    name: normalizeText(registrationFile.name) ?? `Agent ${agentKey}`,
    description: normalizeText(registrationFile.description) ?? `ERC-8004 agent ${agentKey}`,
    image: normalizeText(registrationFile.image) ?? '',
    url: normalizeText(registrationFile.webEndpoint) ?? fallbackUrl,
  }
  assertThing(thing, 'generated.agent.thing')
  return thing
}

function addCreation(atomCreations, ref, purpose, thing) {
  atomCreations.push({
    ref,
    purpose,
    encoding: 'pinThing',
    creationPolicy: purpose === 'partner-owned' ? 'partner-owned' : 'identity-specific',
    resolvePinnedUriBeforeMint: true,
    thing,
  })
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function sealPlan(plan) {
  const unsigned = structuredClone(plan)
  delete unsigned.integrity
  return {
    ...plan,
    integrity: {
      algorithm: 'sha256',
      sha256: createHash('sha256').update(stableStringify(unsigned)).digest('hex'),
    },
  }
}

export function buildPlan(input, registryBundle, preflightEvidence = undefined) {
  assertBundledRegistryBundle(registryBundle)
  const { registry, sha256 } = registryBundle
  const { network, networkConfig, chainId, tokenId, caipId } = identityContext(input, registry)
  const enrichment = normalizeEnrichment(input.enrichment, registry, chainId)
  const query = preflightQuery(registry, network, caipId)
  const checked = preflightState(preflightEvidence, networkConfig, query, registry.erc8004.identityObjectDescription)
  const nextAction = checked.status === 'manual_resolution_required'
    ? 'request-registry-maintainer-resolution-and-stop'
    : checked.status === 'semantic_plan_ready'
      ? 'return-plan-and-stop'
      : 'run-canonical-planner-online-and-stop'
  const base = {
    schemaVersion: 1,
    artifact: PLAN_ARTIFACT,
    status: checked.status,
    mode: 'plan',
    network,
    networkConfig,
    registry: {
      name: registry.registry,
      version: registry.version,
      sha256,
      status: registry.status,
    },
    identity: { chainId, tokenId, caipId },
    enrichment,
    preflight: query,
    preflightEvidence: preflightEvidence ?? null,
    safety: {
      sharedVocabularyCreationAllowed: false,
      labelBasedVocabularySelectionAllowed: false,
      rawStringAgentAllowed: false,
      pinningAllowed: false,
      protocolPreparationAllowed: false,
      unsignedEncodingAllowed: false,
      signingAllowed: false,
      mainnetConfirmationRequired: true,
      broadcastAllowed: false,
    },
    sharedVocabulary: [term(registry, network, 'predicate:same-as')],
    atomCreations: [],
    atomReuses: [],
    triples: [],
    handoff: {
      phase: 'semantic-planning',
      terminal: true,
      nextAction,
      requiresNewUserRequestForProtocolPreparation: true,
      requiresCoreIntuitionSkillInLaterPhase: true,
      readyForProtocolPreparation: false,
      readyForUnsignedEncoding: false,
      authorization: 'not-granted',
      reason: checked.reason ?? null,
      unresolvedEntityRefs: [],
      blockedActions: BLOCKED_ACTIONS,
    },
  }

  if (checked.status !== 'semantic_plan_ready') return sealPlan(base)

  const controlledRegistryIds = new Set(
    registryTermKeys(registry).map((key) => registryTermDescriptor(registry, network, key).termId),
  )
  assertEntity(input.provider, 'provider', { forbiddenAtomIds: controlledRegistryIds })
  assertEntity(input.assessmentSource, 'assessmentSource', {
    requireResolver: true,
    forbiddenAtomIds: controlledRegistryIds,
  })

  const entityIds = {}
  const atomCreations = []
  const atomReuses = []
  let requiresIdentityTriples = false

  if (checked.preflight.status === 'found') {
    entityIds.agent = checked.preflight.agentAtomId
    atomReuses.push({ ref: 'agent', atomId: entityIds.agent, evidence: checked.preflight.sameAsTripleId })
  } else {
    requiresIdentityTriples = true
    const agentThing = agentRecipe(registry, chainId, tokenId, input.agent.registrationFile)
    base.agentRecipe = {
      registrationFile: {
        name: normalizeText(input.agent.registrationFile?.name),
        description: normalizeText(input.agent.registrationFile?.description),
        image: normalizeText(input.agent.registrationFile?.image),
        webEndpoint: normalizeText(input.agent.registrationFile?.webEndpoint),
      },
      thing: agentThing,
    }
    addCreation(atomCreations, 'agent', 'identity-specific', agentThing)
    addCreation(atomCreations, 'identityObject', 'identity-specific', {
      name: caipId,
      description: registry.erc8004.identityObjectDescription,
      image: '',
      url: '',
    })
  }

  for (const [ref, entity, purpose] of [
    ['provider', input.provider, 'partner-owned'],
    ['assessmentSource', input.assessmentSource, 'partner-owned'],
  ]) {
    if (entity.atomId) {
      entityIds[ref] = entity.atomId
      atomReuses.push({ ref, atomId: entity.atomId, evidence: 'partner-supplied; verify term metadata before handoff' })
    } else {
      addCreation(atomCreations, ref, purpose, entity.thing)
    }
  }

  if (enrichment.owner) {
    addCreation(atomCreations, 'owner', 'identity-specific', {
      name: enrichment.owner,
      description: 'Wallet address atom observed in ERC-8004 registry data.',
      image: '',
      url: '',
    })
  }

  const definitions = [
    ...(requiresIdentityTriples ? IDENTITY_TRIPLES : []),
    ...enrichmentDefinitions(registry, chainId, enrichment),
    ...TRUST_TRIPLES,
  ]
  const triples = definitions.map((definition) => makeTriple(registry, network, definition, entityIds))

  return sealPlan({
    ...base,
    status: 'semantic_plan_ready',
    assessment: {
      resolverUrl: input.assessmentSource.resolverUrl,
      semantics: ASSESSMENT_SEMANTICS,
    },
    sharedVocabulary: registryKeysForDefinitions(registry, definitions).map((key) => term(registry, network, key)),
    atomCreations,
    atomReuses,
    triples,
    handoff: {
      phase: 'semantic-planning',
      terminal: true,
      nextAction: 'return-plan-and-stop',
      requiresNewUserRequestForProtocolPreparation: true,
      requiresCoreIntuitionSkillInLaterPhase: true,
      readyForProtocolPreparation: false,
      readyForUnsignedEncoding: false,
      authorization: 'not-granted',
      reason: null,
      unresolvedEntityRefs: atomCreations.map((entry) => entry.ref),
      blockedActions: BLOCKED_ACTIONS,
    },
  })
}

function comparePosition(actual, expected, registry, network, entityRefs, entityIds, errors, path) {
  if (hasRegistryTerm(registry, expected)) {
    const canonical = term(registry, network, expected)
    if (actual?.source !== 'registry' || actual.key !== expected || actual.termId !== canonical.termId) {
      errors.push(`${path} must use registry term ${expected} (${canonical.termId})`)
    }
    return
  }
  if (actual?.source !== 'entity' || actual.ref !== expected) {
    errors.push(`${path} must reference entity ${expected}`)
    return
  }
  if (actual.termId !== null && actual.termId !== undefined && !HEX_32.test(actual.termId)) {
    errors.push(`${path}.termId must be null or bytes32`)
  }
  if (entityIds.has(expected) && actual.termId !== entityIds.get(expected)) {
    errors.push(`${path}.termId must match the ${expected} reuse record`)
  }
  if (!entityIds.has(expected) && actual.termId !== null) {
    errors.push(`${path}.termId must remain null until the ${expected} atom creation resolves`)
  }
  entityRefs.add(expected)
}

function checkExactKeys(value, expectedKeys, path, errors) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${path} must be an object`)
    return
  }
  const actual = Object.keys(value)
  for (const key of actual) {
    if (!expectedKeys.includes(key)) errors.push(`${path}.${key} is not allowed`)
  }
  for (const key of expectedKeys) {
    if (!actual.includes(key)) errors.push(`${path}.${key} is required`)
  }
}

function checkTopLevelKeys(plan, errors) {
  const base = [
    'schemaVersion', 'artifact', 'status', 'mode', 'network', 'networkConfig', 'registry',
    'identity', 'enrichment', 'preflight', 'preflightEvidence', 'safety', 'sharedVocabulary',
    'atomCreations', 'atomReuses', 'triples', 'handoff', 'integrity',
  ]
  const allowed = new Set([...base, 'assessment', 'agentRecipe'])
  for (const key of Object.keys(plan)) {
    if (!allowed.has(key)) errors.push(`plan.${key} is not allowed`)
  }
  for (const key of base) {
    if (!(key in plan)) errors.push(`plan.${key} is required`)
  }
  if (plan.status === 'semantic_plan_ready' && !('assessment' in plan)) errors.push('plan.assessment is required for semantic-plan-ready plans')
  if (plan.status !== 'semantic_plan_ready' && ('assessment' in plan || 'agentRecipe' in plan)) errors.push('non-ready plans must not include assessment or agentRecipe')
}

export function validatePlan(plan, registryBundle) {
  const errors = []
  try {
    assertBundledRegistryBundle(registryBundle)
  } catch (error) {
    return { valid: false, errors: [error.message] }
  }
  const { registry, sha256 } = registryBundle
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return { valid: false, errors: ['plan must be a JSON object'] }
  }
  checkTopLevelKeys(plan, errors)
  checkExactKeys(plan.artifact, ['type', 'producer', 'policy'], 'plan.artifact', errors)
  checkExactKeys(plan.registry, ['name', 'version', 'sha256', 'status'], 'plan.registry', errors)
  checkExactKeys(plan.identity, ['chainId', 'tokenId', 'caipId'], 'plan.identity', errors)
  checkExactKeys(plan.enrichment, [
    'includeRegistrationChain', 'owner', 'protocols', 'x402',
    'trustModels', 'oasfSkills', 'oasfDomains',
  ], 'plan.enrichment', errors)
  checkExactKeys(plan.safety, [
    'sharedVocabularyCreationAllowed', 'labelBasedVocabularySelectionAllowed',
    'rawStringAgentAllowed', 'pinningAllowed', 'protocolPreparationAllowed',
    'unsignedEncodingAllowed', 'signingAllowed', 'mainnetConfirmationRequired',
    'broadcastAllowed',
  ], 'plan.safety', errors)
  checkExactKeys(plan.integrity, ['algorithm', 'sha256'], 'plan.integrity', errors)
  if (plan.schemaVersion !== 1) errors.push('schemaVersion must be 1')
  if (JSON.stringify(plan.artifact) !== JSON.stringify(PLAN_ARTIFACT)) errors.push('plan artifact identity differs from the canonical planner output')
  const network = plan.network
  if (!['preflight_required', 'manual_resolution_required', 'semantic_plan_ready'].includes(plan.status)) errors.push('unknown plan status')
  if (network !== 'mainnet' && network !== 'testnet') errors.push('network must be mainnet or testnet')
  if (plan.registry?.name !== registry.registry) errors.push('registry name mismatch')
  if (plan.registry?.version !== registry.version) errors.push('registry version mismatch')
  if (plan.registry?.sha256 !== sha256) errors.push('registry sha256 mismatch')
  if (plan.registry?.status !== registry.status) errors.push('registry status mismatch')
  if (plan.mode !== 'plan') errors.push('mode must be plan')
  if (plan.safety?.sharedVocabularyCreationAllowed !== false) errors.push('shared vocabulary creation must be disabled')
  if (plan.safety?.labelBasedVocabularySelectionAllowed !== false) errors.push('label-based vocabulary selection must be disabled')
  if (plan.safety?.rawStringAgentAllowed !== false) errors.push('raw-string agents must be disabled')
  if (plan.safety?.pinningAllowed !== false) errors.push('semantic planning must not allow pinning')
  if (plan.safety?.protocolPreparationAllowed !== false) errors.push('semantic planning must not allow protocol preparation')
  if (plan.safety?.unsignedEncodingAllowed !== false) errors.push('semantic planning must not allow unsigned encoding')
  if (plan.safety?.signingAllowed !== false) errors.push('semantic planning must not allow signing')
  if (plan.safety?.mainnetConfirmationRequired !== true) errors.push('mainnet confirmation must be required')
  if (plan.safety?.broadcastAllowed !== false) errors.push('broadcast must remain disabled')
  const unsigned = structuredClone(plan)
  delete unsigned.integrity
  const expectedIntegrity = createHash('sha256').update(stableStringify(unsigned)).digest('hex')
  if (plan.integrity?.algorithm !== 'sha256' || plan.integrity?.sha256 !== expectedIntegrity) {
    errors.push('plan integrity hash mismatch; rebuild from the manifest instead of editing the plan')
  }

  const identityRegistry = registry.erc8004.identityRegistry
  const identityChainId = plan.identity?.chainId
  const identityTokenId = String(plan.identity?.tokenId ?? '')
  const expectedCaipId = Number.isSafeInteger(identityChainId) && DECIMAL_ID.test(identityTokenId)
    ? `eip155:${identityChainId}/erc721:${identityRegistry}/${identityTokenId}`
    : null
  if (!expectedCaipId || plan.identity?.caipId !== expectedCaipId) errors.push('identity CAIP fields are invalid or inconsistent')

  let expectedEnrichment
  try {
    expectedEnrichment = normalizeEnrichment(plan.enrichment, registry, identityChainId)
    if (JSON.stringify(plan.enrichment) !== JSON.stringify(expectedEnrichment)) errors.push('plan enrichment is not canonically normalized')
  } catch (error) {
    errors.push(error.message)
  }

  if (network === 'mainnet' || network === 'testnet') {
    if (JSON.stringify(plan.networkConfig) !== JSON.stringify(registry.networks[network])) errors.push('network configuration differs from registry')
    const actualTerms = Array.isArray(plan.sharedVocabulary) ? plan.sharedVocabulary : []
    const vocabularyKeys = actualTerms.map((entry) => entry?.key)
    if (new Set(vocabularyKeys).size !== vocabularyKeys.length) errors.push('shared vocabulary keys must be unique')
    for (const actual of actualTerms) {
      const key = actual?.key
      checkExactKeys(actual, ['key', 'label', 'kind', 'termId', 'createPolicy'], `sharedVocabulary.${key}`, errors)
      try {
        const canonical = term(registry, network, key)
        if (actual.label !== canonical.label || actual.kind !== canonical.kind || actual.termId !== canonical.termId || actual.createPolicy !== 'resolve-only') {
          errors.push(`shared vocabulary term ${key} is missing or altered`)
        }
      } catch (error) {
        errors.push(error.message)
      }
    }
  }

  if (network === 'mainnet' || network === 'testnet') {
    const expectedPreflight = preflightQuery(registry, network, expectedCaipId)
    if (JSON.stringify(plan.preflight) !== JSON.stringify(expectedPreflight)) errors.push('preflight query, variables, or interpretation differ from the canonical template')
    try {
      const evidenceState = preflightState(
        plan.preflightEvidence,
        registry.networks[network],
        expectedPreflight,
        registry.erc8004.identityObjectDescription,
      )
      if (evidenceState.status !== plan.status) errors.push(`plan status ${plan.status} does not match preflight evidence state ${evidenceState.status}`)
    } catch (error) {
      errors.push(error.message)
    }
    if (plan.preflightEvidence !== null) {
      const common = ['source', 'status', 'matchCount', 'checkedAt', 'graphqlEndpoint', 'querySha256', 'rows', 'responseSha256']
      const evidenceKeys = plan.preflightEvidence.status === 'found'
        ? [...common, 'agentAtomId', 'sameAsTripleId']
        : common
      checkExactKeys(plan.preflightEvidence, evidenceKeys, 'plan.preflightEvidence', errors)
      if (Array.isArray(plan.preflightEvidence.rows)) {
        for (const [index, row] of plan.preflightEvidence.rows.entries()) {
          checkExactKeys(row, [
            'sameAsTripleId', 'agentAtomId', 'predicateId', 'identityObjectId',
            'identityName', 'agentThing', 'identityThing',
          ], `plan.preflightEvidence.rows[${index}]`, errors)
        }
      }
    }
  }

  const canonicalLabels = new Set(registryTermKeys(registry).map((key) => registryEntry(registry, key).label.trim().toLowerCase()))
  const creations = Array.isArray(plan.atomCreations) ? plan.atomCreations : []
  const creationRefsList = creations.map((entry) => entry.ref)
  if (new Set(creationRefsList).size !== creationRefsList.length) errors.push('atom creation refs must be unique')
  for (const [index, creation] of creations.entries()) {
    checkExactKeys(creation, ['ref', 'purpose', 'encoding', 'creationPolicy', 'resolvePinnedUriBeforeMint', 'thing'], `atomCreations[${index}]`, errors)
    if (!ALLOWED_CREATION_REFS.has(creation.ref)) errors.push(`atomCreations[${index}].ref is not partner-owned or identity-specific`)
    const expectedPurpose = ['agent', 'identityObject', 'owner'].includes(creation.ref) ? 'identity-specific' : 'partner-owned'
    if (creation.purpose !== expectedPurpose || creation.creationPolicy !== expectedPurpose) {
      errors.push(`atomCreations[${index}] purpose and creationPolicy must be ${expectedPurpose}`)
    }
    if (creation.encoding !== 'pinThing') errors.push(`atomCreations[${index}] must use pinThing`)
    if (creation.resolvePinnedUriBeforeMint !== true) errors.push(`atomCreations[${index}] must resolve before mint`)
    if (!creation.thing || typeof creation.thing !== 'object') {
      errors.push(`atomCreations[${index}].thing is required`)
      continue
    }
    try {
      assertThing(creation.thing, `atomCreations[${index}].thing`)
    } catch (error) {
      errors.push(error.message)
    }
    if ('canonicalKey' in creation.thing) errors.push(`atomCreations[${index}].thing must not include canonicalKey`)
    if (canonicalLabels.has(String(creation.thing.name ?? '').trim().toLowerCase())) {
      errors.push(`atomCreations[${index}] attempts to create shared vocabulary by label`)
    }
  }

  const handoffKeys = [
    'phase', 'terminal', 'nextAction',
    'requiresNewUserRequestForProtocolPreparation',
    'requiresCoreIntuitionSkillInLaterPhase', 'readyForProtocolPreparation',
    'readyForUnsignedEncoding', 'authorization', 'reason',
    'unresolvedEntityRefs', 'blockedActions',
  ]
  checkExactKeys(plan.handoff, handoffKeys, 'plan.handoff', errors)
  if (plan.handoff?.phase !== 'semantic-planning') errors.push('plan handoff phase must remain semantic-planning')
  if (plan.handoff?.terminal !== true) errors.push('semantic planning must terminate after returning the plan')
  if (plan.handoff?.requiresNewUserRequestForProtocolPreparation !== true) errors.push('protocol preparation requires a new user request')
  if (plan.handoff?.requiresCoreIntuitionSkillInLaterPhase !== true) errors.push('core intuition skill use must remain in a later phase')
  if (plan.handoff?.readyForProtocolPreparation !== false) errors.push('semantic planning is not ready for protocol preparation')
  if (plan.handoff?.readyForUnsignedEncoding !== false) errors.push('semantic planning is not ready for unsigned encoding')
  if (plan.handoff?.authorization !== 'not-granted') errors.push('plan generation must not grant write authorization')
  if (JSON.stringify(plan.handoff?.blockedActions) !== JSON.stringify(BLOCKED_ACTIONS)) errors.push('handoff blockedActions differ from the canonical planning boundary')

  if (plan.status !== 'semantic_plan_ready') {
    if (creations.length !== 0 || (Array.isArray(plan.triples) && plan.triples.length !== 0)) {
      errors.push('non-ready plans must contain no writes')
    }
    if (JSON.stringify(plan.handoff?.unresolvedEntityRefs) !== '[]') errors.push('non-ready plan unresolvedEntityRefs must be empty')
    const expectedReason = plan.status === 'manual_resolution_required' ? 'ambiguous' : plan.preflightEvidence ? 'stale' : 'missing'
    if (plan.handoff?.reason !== expectedReason) errors.push(`non-ready plan reason must be ${expectedReason}`)
    const expectedNextAction = plan.status === 'manual_resolution_required'
      ? 'request-registry-maintainer-resolution-and-stop'
      : 'run-canonical-planner-online-and-stop'
    if (plan.handoff?.nextAction !== expectedNextAction) errors.push(`non-ready plan nextAction must be ${expectedNextAction}`)
    if (JSON.stringify(plan.sharedVocabulary?.map((entry) => entry.key)) !== JSON.stringify(['predicate:same-as'])) {
      errors.push('non-ready plan shared vocabulary must contain only the preflight predicate')
    }
    return { valid: errors.length === 0, errors }
  }

  checkExactKeys(plan.assessment, ['resolverUrl', 'semantics'], 'plan.assessment', errors)
  if (plan.handoff?.nextAction !== 'return-plan-and-stop') errors.push('semantic-plan-ready nextAction must be return-plan-and-stop')
  if (plan.handoff?.reason !== null) errors.push('semantic-plan-ready handoff reason must be null')
  try {
    assertHttpsUrl(plan.assessment?.resolverUrl, 'assessment.resolverUrl')
  } catch (error) {
    errors.push(error.message)
  }
  if (plan.assessment?.semantics !== ASSESSMENT_SEMANTICS) errors.push('assessment semantics differ from the canonical non-endorsement meaning')

  const sourceCreation = creations.find((entry) => entry.ref === 'assessmentSource')
  if (sourceCreation && sourceCreation.thing?.url !== plan.assessment?.resolverUrl) {
    errors.push('assessment source Thing URL must equal assessment.resolverUrl')
  }

  const creationRefs = new Set(creations.map((entry) => entry.ref))
  const reuses = Array.isArray(plan.atomReuses) ? plan.atomReuses : []
  const reuseRefsList = reuses.map((entry) => entry.ref)
  if (new Set(reuseRefsList).size !== reuseRefsList.length) errors.push('atom reuse refs must be unique')
  const reuseRefs = new Set(reuseRefsList)
  for (const ref of creationRefs) {
    if (reuseRefs.has(ref)) errors.push(`entity ${ref} cannot be both created and reused`)
  }
  const entityIds = new Map()
  const controlledRegistryIds = new Set(
    registryTermKeys(registry).map((key) => registryTermDescriptor(registry, network, key).termId),
  )
  for (const [index, reuse] of reuses.entries()) {
    checkExactKeys(reuse, ['ref', 'atomId', 'evidence'], `atomReuses[${index}]`, errors)
    if (!ALLOWED_CREATION_REFS.has(reuse.ref)) errors.push(`atomReuses[${index}].ref is invalid`)
    if (!HEX_32.test(reuse.atomId ?? '')) errors.push(`atomReuses[${index}].atomId must be bytes32`)
    else entityIds.set(reuse.ref, reuse.atomId)
    if (controlledRegistryIds.has(reuse.atomId)) errors.push(`atomReuses[${index}].atomId is a controlled registry term and cannot be used as entity ${reuse.ref}`)
    if (reuse.ref !== 'agent' && reuse.evidence !== 'partner-supplied; verify term metadata before handoff') {
      errors.push(`atomReuses[${index}].evidence differs from the required verification instruction`)
    }
  }
  const createsAgent = creationRefs.has('agent')
  if (createsAgent !== creationRefs.has('identityObject')) errors.push('agent and identityObject must be created together')
  if (createsAgent) {
    const identityCreation = creations.find((entry) => entry.ref === 'identityObject')
    const expectedIdentityThing = {
      name: expectedCaipId,
      description: registry.erc8004.identityObjectDescription,
      image: '',
      url: '',
    }
    if (JSON.stringify(identityCreation?.thing) !== JSON.stringify(expectedIdentityThing)) {
      errors.push('identityObject must use the exact canonical CAIP Thing recipe')
    }
    checkExactKeys(plan.agentRecipe, ['registrationFile', 'thing'], 'plan.agentRecipe', errors)
    checkExactKeys(plan.agentRecipe?.registrationFile, ['name', 'description', 'image', 'webEndpoint'], 'plan.agentRecipe.registrationFile', errors)
    let expectedAgentThing
    try {
      expectedAgentThing = agentRecipe(registry, identityChainId, identityTokenId, plan.agentRecipe?.registrationFile)
    } catch (error) {
      errors.push(error.message)
    }
    const agentCreation = creations.find((entry) => entry.ref === 'agent')
    if (!expectedAgentThing || JSON.stringify(plan.agentRecipe?.thing) !== JSON.stringify(expectedAgentThing) || JSON.stringify(agentCreation?.thing) !== JSON.stringify(expectedAgentThing)) {
      errors.push('agent must use the exact canonical registration-file recipe')
    }
    if (plan.preflightEvidence?.status !== 'not_found' || plan.preflightEvidence?.matchCount !== 0) {
      errors.push('agent creation requires live zero-match preflight evidence')
    }
  } else if (!reuseRefs.has('agent')) {
    errors.push('semantic-plan-ready plan must create or reuse the canonical agent')
  } else {
    if ('agentRecipe' in plan) errors.push('agentRecipe is allowed only when creating a missing agent')
    const agentReuse = reuses.find((entry) => entry.ref === 'agent')
    if (plan.preflightEvidence?.status !== 'found' || plan.preflightEvidence?.matchCount !== 1 ||
        agentReuse?.atomId !== plan.preflightEvidence?.agentAtomId || agentReuse?.evidence !== plan.preflightEvidence?.sameAsTripleId) {
      errors.push('agent reuse must match the live one-match preflight evidence tuple')
    }
  }
  for (const ref of ['agent', 'provider', 'assessmentSource']) {
    if (Number(creationRefs.has(ref)) + Number(reuseRefs.has(ref)) !== 1) errors.push(`entity ${ref} must be created or reused exactly once`)
  }
  if (reuseRefs.has('identityObject')) errors.push('identityObject may be created only as part of a missing-agent recipe')
  if (reuseRefs.has('owner')) errors.push('owner is resolved from its exact Thing recipe during the later protocol phase')
  const ownerCreation = creations.find((entry) => entry.ref === 'owner')
  if (expectedEnrichment?.owner) {
    if (JSON.stringify(ownerCreation?.thing) !== JSON.stringify({
      name: expectedEnrichment.owner,
      description: 'Wallet address atom observed in ERC-8004 registry data.',
      image: '',
      url: '',
    })) errors.push('owner must use the exact canonical ERC-8004 owner Thing recipe')
  } else if (ownerCreation) {
    errors.push('owner creation requires enrichment.owner')
  }
  const expectedCreationOrder = [
    ...(createsAgent ? ['agent', 'identityObject'] : []),
    ...(['provider', 'assessmentSource'].filter((ref) => creationRefs.has(ref))),
    ...(expectedEnrichment?.owner ? ['owner'] : []),
  ]
  if (JSON.stringify(creationRefsList) !== JSON.stringify(expectedCreationOrder)) errors.push('atom creation order differs from the canonical staged order')
  const expectedReuseOrder = [
    ...(!createsAgent ? ['agent'] : []),
    ...(['provider', 'assessmentSource'].filter((ref) => reuseRefs.has(ref))),
  ]
  if (JSON.stringify(reuseRefsList) !== JSON.stringify(expectedReuseOrder)) errors.push('atom reuse order differs from the canonical staged order')
  if (JSON.stringify(plan.handoff?.unresolvedEntityRefs) !== JSON.stringify(creationRefsList)) errors.push('handoff unresolvedEntityRefs must exactly match atom creation order')
  const expected = [
    ...(createsAgent ? IDENTITY_TRIPLES : []),
    ...enrichmentDefinitions(registry, identityChainId, expectedEnrichment ?? normalizeEnrichment(undefined, registry, identityChainId)),
    ...TRUST_TRIPLES,
  ]
  const expectedVocabularyKeys = registryKeysForDefinitions(registry, expected)
  if (JSON.stringify(plan.sharedVocabulary?.map((entry) => entry.key)) !== JSON.stringify(expectedVocabularyKeys)) {
    errors.push('shared vocabulary list does not match the canonical Triple definitions')
  }
  const triples = Array.isArray(plan.triples) ? plan.triples : []
  if (triples.length !== expected.length) errors.push(`expected exactly ${expected.length} triples`)
  const entityRefs = new Set()
  for (const [index, definition] of expected.entries()) {
    const [key, subject, predicate, object] = definition
    const actual = triples[index]
    if (!actual) {
      errors.push(`missing triple ${key}`)
      continue
    }
    checkExactKeys(actual, ['key', 'subject', 'predicate', 'object', 'createIfMissing'], `triples[${index}]`, errors)
    if (actual.key !== key) errors.push(`triples[${index}] must be ${key}`)
    checkExactKeys(actual.subject, actual.subject?.source === 'registry' ? ['source', 'key', 'label', 'termId'] : ['source', 'ref', 'termId'], `triples[${index}].subject`, errors)
    checkExactKeys(actual.predicate, ['source', 'key', 'label', 'termId'], `triples[${index}].predicate`, errors)
    checkExactKeys(actual.object, actual.object?.source === 'registry' ? ['source', 'key', 'label', 'termId'] : ['source', 'ref', 'termId'], `triples[${index}].object`, errors)
    comparePosition(actual.subject, subject, registry, network, entityRefs, entityIds, errors, `triples.${key}.subject`)
    comparePosition(actual.predicate, predicate, registry, network, entityRefs, entityIds, errors, `triples.${key}.predicate`)
    comparePosition(actual.object, object, registry, network, entityRefs, entityIds, errors, `triples.${key}.object`)
    if (actual.createIfMissing !== true) errors.push(`triple ${key} must use createIfMissing=true after existence check`)
  }
  for (const ref of entityRefs) {
    if (!creationRefs.has(ref) && !reuseRefs.has(ref)) errors.push(`entity reference ${ref} has no creation or reuse record`)
  }

  return { valid: errors.length === 0, errors }
}

export async function readJsonSource(path) {
  if (path) return JSON.parse(await readFile(path, 'utf8'))
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  invariant(chunks.length > 0, 'input_required', 'Pass --input <file> or pipe JSON on stdin')
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

export function parseCliArgs(argv, {
  allowOffline = false,
  allowPreflightOnly = false,
  allowOutput = false,
} = {}) {
  const args = { pretty: true }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--input') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new PlanError('missing_argument_value', '--input requires a file path')
      }
      args.input = value
      index += 1
    } else if (arg === '--output' && allowOutput) {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new PlanError('missing_argument_value', '--output requires a file path')
      }
      args.output = value
      index += 1
    } else if (arg === '--compact') args.pretty = false
    else if (arg === '--offline' && allowOffline) args.offline = true
    else if (arg === '--preflight-only' && allowPreflightOnly) args.preflightOnly = true
    else if (arg === '--registry') throw new PlanError('registry_override_forbidden', 'The production planner and validator use only the bundled registry')
    else if (arg === '--help' || arg === '-h') args.help = true
    else throw new PlanError('unknown_argument', `Unknown argument: ${arg}`)
  }
  return args
}

export function printJson(value, pretty = true, stream = process.stdout) {
  stream.write(`${JSON.stringify(value, null, pretty ? 2 : 0)}\n`)
}

export function errorPayload(error) {
  return {
    status: 'failure',
    error: {
      code: error instanceof PlanError ? error.code : 'unexpected_error',
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof PlanError && error.details !== undefined ? { details: error.details } : {}),
    },
  }
}
