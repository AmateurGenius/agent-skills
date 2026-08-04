import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  PlanError,
  buildPlan,
  loadRegistry,
  parseCliArgs,
  registryTermDescriptor,
  registryTermKeys,
  revalidatePlanPreflight,
  resolveAgentPreflight,
  validatePlan,
} from '../skills/erc8004-agent-layer/scripts/partner-plan.mjs'

const registryBundle = await loadRegistry()
const skillText = await readFile(new URL('../skills/erc8004-agent-layer/SKILL.md', import.meta.url), 'utf8')
const readmeText = await readFile(new URL('../skills/erc8004-agent-layer/README.md', import.meta.url), 'utf8')
const workflowText = await readFile(new URL('../skills/erc8004-agent-layer/reference/workflow.md', import.meta.url), 'utf8')
const id = (character) => `0x${character.repeat(64)}`
const AGENT_ID = '0x45078ae569def2264355f77e592028dd6f1f5d6373c204fe82bf3141ab1861fb'
const SAME_AS_TRIPLE_ID = '0xd91720b4777ca98694715624169d070db8f91e72ad666dd91bc4f7c8b9509b4f'

function baseInput() {
  return {
    schemaVersion: 1,
    network: 'testnet',
    agent: {
      chainId: 8453,
      tokenId: '1380',
    },
    provider: {
      thing: {
        name: 'Acme Trust',
        description: 'Publishes independent trust assessments.',
        image: 'https://acme.example/logo.png',
        url: 'https://acme.example',
      },
    },
    assessmentSource: {
      resolverUrl: 'https://acme.example/.well-known/intuition/erc8004/agents/8453/1380/trust-assessment.json',
      thing: {
        name: 'Acme assessment for Captain Dackie',
        description: 'Current Acme trust assessment for ERC-8004 agent 8453:1380.',
        image: 'https://acme.example/logo.png',
        url: 'https://acme.example/.well-known/intuition/erc8004/agents/8453/1380/trust-assessment.json',
      },
    },
  }
}

function caipId(input) {
  return `eip155:${input.agent.chainId}/erc721:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432/${input.agent.tokenId}`
}

function row(input, tripleId = SAME_AS_TRIPLE_ID, agentAtomId = AGENT_ID) {
  return {
    term_id: tripleId,
    subject: {
      term_id: agentAtomId,
      value: {
        thing: {
          name: 'Captain Dackie',
          description: 'An ERC-8004 agent used for deterministic planner tests.',
          image: 'https://agent.example/captain.png',
          url: 'https://agent.example/captain',
        },
      },
    },
    predicate: { term_id: '0xbeebfb7d177cbd96ffc239d2196c72ec346efe81f39dc595773f13d83506f5f0' },
    object: {
      term_id: id('9'),
      value: {
        thing: {
          name: caipId(input),
          description: 'CAIP-style external identifier atom for linking an Intuition atom to an ERC-8004 registry identity.',
          image: '',
          url: '',
        },
      },
    },
  }
}

async function evidence(input, rows) {
  return resolveAgentPreflight(input, registryBundle, {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { triples: rows } }),
    }),
  })
}

const foundEvidence = (input) => evidence(input, [row(input)])
const missingEvidence = (input) => evidence(input, [])
const ambiguousEvidence = (input) => evidence(input, [row(input), row(input, id('2'), id('3'))])

test('offline planning emits a valid no-write preflight state', () => {
  const plan = buildPlan(baseInput(), registryBundle)
  assert.equal(plan.status, 'preflight_required')
  assert.equal(plan.artifact.policy, 'canonical-output-only')
  assert.equal(plan.preflight.variables.sameAsPredicateId, '0xbeebfb7d177cbd96ffc239d2196c72ec346efe81f39dc595773f13d83506f5f0')
  assert.deepEqual(plan.atomCreations, [])
  assert.deepEqual(plan.atomReuses, [])
  assert.deepEqual(plan.triples, [])
  assert.equal(plan.handoff.terminal, true)
  assert.equal(plan.handoff.nextAction, 'run-canonical-planner-online-and-stop')
  assert.equal(validatePlan(plan, registryBundle).valid, true)
})

test('live one-match evidence produces exactly four canonical trust edges', async () => {
  const input = baseInput()
  const plan = buildPlan(input, registryBundle, await foundEvidence(input))
  assert.equal(plan.status, 'semantic_plan_ready')
  assert.equal(plan.preflightEvidence.source, 'live-query')
  assert.equal(plan.preflightEvidence.sameAsTripleId, SAME_AS_TRIPLE_ID)
  assert.deepEqual(plan.triples.map((entry) => entry.key), [
    'trust-provider',
    'trust-assessment',
    'assessment-provider',
    'assessment-type',
  ])
  assert.equal(plan.triples[0].predicate.termId, '0xdc3c5639b39f9b6553b75b37c47fa4810961392b28956234ba9f401a98f43888')
  assert.equal(plan.triples[3].object.termId, '0xf8a0ea34c8e7195b63d1641141166cc56e9128e25cf8c9f68ac6b81527b78f07')
  assert.equal(validatePlan(plan, registryBundle).valid, true)
})

test('optional enrichment maps partner intent to canonical registry terms only', async () => {
  const input = baseInput()
  input.enrichment = {
    includeRegistrationChain: true,
    owner: '0xF9D1D63F362BBF1EE08AB9ACB36FE74AFC48D5F1',
    protocols: ['mcp', 'a2a', 'oasf'],
    x402: true,
    trustModels: ['reputation'],
    oasfSkills: ['tool_interaction/blockchain_interaction'],
    oasfDomains: ['technology/blockchain'],
  }
  const plan = buildPlan(input, registryBundle, await foundEvidence(input))
  assert.deepEqual(plan.enrichment, {
    includeRegistrationChain: true,
    owner: '0xf9d1d63f362bbf1ee08ab9acb36fe74afc48d5f1',
    protocols: ['mcp', 'a2a', 'oasf'],
    x402: true,
    trustModels: ['reputation'],
    oasfSkills: ['tool_interaction/blockchain_interaction'],
    oasfDomains: ['technology/blockchain'],
  })
  assert.deepEqual(plan.triples.map((entry) => entry.key), [
    'enrichment-chain',
    'enrichment-owner',
    'enrichment-type-mcp',
    'enrichment-use-mcp',
    'enrichment-type-a2a',
    'enrichment-use-a2a',
    'enrichment-use-oasf',
    'enrichment-tag-x402',
    'enrichment-compatible-x402',
    'enrichment-trust-model:reputation',
    'enrichment-oasf-skill:tool_interaction/blockchain_interaction',
    'enrichment-oasf-domain:technology/blockchain',
    'trust-provider',
    'trust-assessment',
    'assessment-provider',
    'assessment-type',
  ])
  const owner = plan.atomCreations.find((entry) => entry.ref === 'owner')
  assert.deepEqual(owner.thing, {
    name: input.enrichment.owner.toLowerCase(),
    description: 'Wallet address atom observed in ERC-8004 registry data.',
    image: '',
    url: '',
  })
  assert.equal(plan.triples.every((triple) => triple.predicate.source === 'registry'), true)
  assert.equal(validatePlan(plan, registryBundle).valid, true)
})

test('enrichment refuses vocabulary outside the bundled registry', async () => {
  const input = baseInput()
  input.enrichment = {
    includeRegistrationChain: false,
    owner: null,
    protocols: [],
    x402: false,
    trustModels: ['social-score-v9'],
    oasfSkills: ['unpublished/skill'],
    oasfDomains: [],
  }
  const preflight = await foundEvidence(input)
  assert.throws(() => buildPlan(input, registryBundle, preflight), (error) => {
    assert.equal(error.code, 'registry_extension_required')
    assert.equal(error.details?.field, 'enrichment.trustModels')
    assert.equal(error.details?.value, 'social-score-v9')
    return true
  })
})

test('enrichment refuses an unregistered source chain without blocking trust-only plans', async () => {
  const input = baseInput()
  input.agent.chainId = 77220722
  input.agent.tokenId = '20260722'
  const preflight = await foundEvidence(input)
  const trustOnly = buildPlan(input, registryBundle, preflight)
  assert.equal(trustOnly.triples.length, 4)

  input.enrichment = {
    includeRegistrationChain: true,
    owner: null,
    protocols: [],
    x402: false,
    trustModels: [],
    oasfSkills: [],
    oasfDomains: [],
  }
  assert.throws(() => buildPlan(input, registryBundle, preflight), (error) => {
    assert.equal(error.code, 'registry_extension_required')
    assert.equal(error.details?.field, 'enrichment.includeRegistrationChain')
    assert.equal(error.details?.value, '77220722')
    return true
  })
})

test('enrichment collapses catalog aliases that resolve to the same term ID', async () => {
  const input = baseInput()
  input.enrichment = {
    includeRegistrationChain: false,
    owner: null,
    protocols: [],
    x402: false,
    trustModels: [],
    oasfSkills: [
      'natural_language_processing/analytical_reasoning/analytical_reasoning',
      'natural_language_processing/analytical_reasoning',
    ],
    oasfDomains: [
      'finance_and_business/finance_and_business',
      'finance_and_business',
    ],
  }
  const plan = buildPlan(input, registryBundle, await foundEvidence(input))
  assert.deepEqual(plan.enrichment.oasfSkills, ['natural_language_processing/analytical_reasoning'])
  assert.deepEqual(plan.enrichment.oasfDomains, ['finance_and_business'])
  assert.equal(plan.triples.filter((entry) => entry.key.startsWith('enrichment-oasf-')).length, 2)
  assert.equal(validatePlan(plan, registryBundle).valid, true)
})

test('live zero-match evidence produces the frozen identity recipe and seven edges', async () => {
  const input = baseInput()
  input.agent.registrationFile = {
    name: '  ',
    description: null,
    image: null,
    webEndpoint: null,
  }
  const plan = buildPlan(input, registryBundle, await missingEvidence(input))
  assert.equal(plan.status, 'semantic_plan_ready')
  assert.equal(plan.triples.length, 7)
  const agent = plan.atomCreations.find((entry) => entry.ref === 'agent')
  assert.deepEqual(agent.thing, {
    name: 'Agent 8453:1380',
    description: 'ERC-8004 agent 8453:1380',
    image: '',
    url: 'https://8004scan.io/agents/8453/1380',
  })
  const identity = plan.atomCreations.find((entry) => entry.ref === 'identityObject')
  assert.equal(identity.thing.name, caipId(input))
  assert.equal(validatePlan(plan, registryBundle).valid, true)
})

test('live ambiguous identity returns no speculative writes', async () => {
  const input = baseInput()
  const plan = buildPlan(input, registryBundle, await ambiguousEvidence(input))
  assert.equal(plan.status, 'manual_resolution_required')
  assert.equal(plan.triples.length, 0)
  assert.equal(plan.atomCreations.length, 0)
  assert.equal(validatePlan(plan, registryBundle).valid, true)
})

test('stale evidence cannot unlock writes', async () => {
  const input = baseInput()
  const preflight = await foundEvidence(input)
  preflight.checkedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
  const plan = buildPlan(input, registryBundle, preflight)
  assert.equal(plan.status, 'preflight_required')
  assert.equal(plan.handoff.reason, 'stale')
  assert.equal(plan.triples.length, 0)
  assert.equal(validatePlan(plan, registryBundle).valid, true)
})

test('manifest-supplied preflight claims are rejected', async () => {
  const input = baseInput()
  input.agent.preflight = { status: 'found', agentAtomId: id('a') }
  assert.throws(() => buildPlan(input, registryBundle), (error) => {
    assert.equal(error.code, 'manifest_preflight_forbidden')
    return true
  })
})

test('manifest rejects unknown identity, registry, and entity-role fields', () => {
  const topLevel = baseInput()
  topLevel.registry = { 'predicate:has-trust-provider': id('c') }
  assert.throws(() => buildPlan(topLevel, registryBundle), (error) => {
    assert.equal(error.code, 'unknown_manifest_field')
    assert.deepEqual(error.details?.unknownFields, ['registry'])
    return true
  })

  const identity = baseInput()
  identity.agent.sameAsTripleId = id('b')
  assert.throws(() => buildPlan(identity, registryBundle), (error) => {
    assert.equal(error.code, 'unknown_manifest_field')
    assert.deepEqual(error.details?.unknownFields, ['sameAsTripleId'])
    return true
  })

  const entity = baseInput()
  entity.provider.predicateId = id('c')
  assert.throws(() => buildPlan(entity, registryBundle), (error) => {
    assert.equal(error.code, 'unknown_manifest_field')
    assert.deepEqual(error.details?.unknownFields, ['predicateId'])
    return true
  })
})

test('planner rejects unsafe numeric token IDs before CAIP construction', () => {
  const unsafe = baseInput()
  unsafe.agent.tokenId = Number.MAX_SAFE_INTEGER + 1
  assert.throws(() => buildPlan(unsafe, registryBundle), (error) => {
    assert.equal(error.code, 'invalid_erc8004_token')
    assert.match(error.message, /use a string for large token IDs/)
    return true
  })

  const uint256String = baseInput()
  uint256String.agent.tokenId = '115792089237316195423570985008687907853269984665640564039457584007913129639935'
  const plan = buildPlan(uint256String, registryBundle)
  assert.equal(plan.identity.tokenId, uint256String.agent.tokenId)
  assert.match(plan.identity.caipId, new RegExp(`${uint256String.agent.tokenId}$`))
})

test('preflight evidence from the wrong network is rejected', async () => {
  const input = baseInput()
  const preflight = await foundEvidence(input)
  preflight.graphqlEndpoint = 'https://mainnet.intuition.sh/v1/graphql'
  assert.throws(() => buildPlan(input, registryBundle, preflight), (error) => {
    assert.equal(error instanceof PlanError, true)
    assert.equal(error.code, 'wrong_preflight_endpoint')
    return true
  })
})

test('preflight helper rejects response tuples with a noncanonical predicate', async () => {
  const input = baseInput()
  const invalid = row(input)
  invalid.predicate.term_id = id('a')
  await assert.rejects(() => evidence(input, [invalid]), (error) => {
    assert.equal(error.code, 'invalid_preflight_response')
    return true
  })
})

test('preflight helper retries a transient network failure inside the canonical command', async () => {
  const input = baseInput()
  let attempts = 0
  const result = await resolveAgentPreflight(input, registryBundle, {
    retryDelaysMs: [0, 0],
    fetchImpl: async () => {
      attempts += 1
      if (attempts === 1) throw new TypeError('fetch failed')
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { triples: [row(input)] } }),
      }
    },
  })
  assert.equal(attempts, 2)
  assert.equal(result.status, 'found')
  assert.equal(result.agentAtomId, AGENT_ID)
})

test('preflight helper rejects raw agent subjects and lookalike identity Things', async () => {
  const input = baseInput()
  const rawSubject = row(input)
  rawSubject.subject.value.thing = null
  await assert.rejects(() => evidence(input, [rawSubject]), (error) => {
    assert.equal(error.code, 'invalid_preflight_response')
    return true
  })

  const lookalikeIdentity = row(input)
  lookalikeIdentity.object.value.thing.description = 'Same name, different identity recipe.'
  await assert.rejects(() => evidence(input, [lookalikeIdentity]), (error) => {
    assert.equal(error.code, 'invalid_preflight_response')
    return true
  })
})

test('fresh preflight revalidation detects identity state changes', async () => {
  const input = baseInput()
  const plan = buildPlan(input, registryBundle, await foundEvidence(input))
  const same = await revalidatePlanPreflight(plan, registryBundle, {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { triples: [row(input)] } }),
    }),
  })
  assert.equal(same.valid, true)

  const changed = await revalidatePlanPreflight(plan, registryBundle, {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { triples: [] } }),
    }),
  })
  assert.equal(changed.valid, false)
  assert.match(changed.errors.join('\n'), /fresh canonical identity query/)
})

test('validator rejects a substituted duplicate predicate ID', async () => {
  const input = baseInput()
  const plan = buildPlan(input, registryBundle, await foundEvidence(input))
  plan.triples[0].predicate.termId = id('a')
  const result = validatePlan(plan, registryBundle)
  assert.equal(result.valid, false)
  assert.match(result.errors.join('\n'), /predicate:has-trust-provider/)
})

test('validator rejects a substituted entity ID even when it is valid bytes32', async () => {
  const input = baseInput()
  input.provider = { atomId: id('2') }
  input.assessmentSource = {
    atomId: id('3'),
    resolverUrl: 'https://acme.example/.well-known/intuition/erc8004/agents/8453/1380/trust-assessment.json',
  }
  const plan = buildPlan(input, registryBundle, await foundEvidence(input))
  plan.triples[0].object.termId = id('4')
  const result = validatePlan(plan, registryBundle)
  assert.equal(result.valid, false)
  assert.match(result.errors.join('\n'), /must match the provider reuse record/)
})

test('validator rejects shared-vocabulary creation disguised as an extra atom', async () => {
  const input = baseInput()
  const plan = buildPlan(input, registryBundle, await foundEvidence(input))
  plan.atomCreations.push({
    ref: 'customPredicate',
    purpose: 'partner-owned',
    encoding: 'pinThing',
    creationPolicy: 'partner-owned',
    resolvePinnedUriBeforeMint: true,
    thing: { name: ' has trust provider ', description: 'duplicate', image: '', url: '' },
  })
  const result = validatePlan(plan, registryBundle)
  assert.equal(result.valid, false)
  assert.match(result.errors.join('\n'), /shared vocabulary by label/)
})

test('validator rejects extra execution, signing, or broadcast instructions', async () => {
  const input = baseInput()
  const plan = buildPlan(input, registryBundle, await foundEvidence(input))
  plan.execution = { broadcast: true, signedTransaction: '0xdeadbeef' }
  plan.handoff.blockedActions = []
  const result = validatePlan(plan, registryBundle)
  assert.equal(result.valid, false)
  assert.match(result.errors.join('\n'), /plan.execution is not allowed/)
  assert.match(result.errors.join('\n'), /blockedActions differ/)
})

test('planner and validator reject controlled registry IDs in entity slots', async () => {
  const input = baseInput()
  input.provider = {
    atomId: registryBundle.registry.terms['predicate:has-trust-provider'].termIds.testnet,
  }
  const preflight = await foundEvidence(input)
  assert.throws(() => buildPlan(input, registryBundle, preflight), (error) => {
    assert.equal(error.code, 'registry_term_as_entity_forbidden')
    return true
  })

  const validInput = baseInput()
  validInput.provider = { atomId: id('2') }
  const plan = buildPlan(validInput, registryBundle, await foundEvidence(validInput))
  plan.atomReuses.find((entry) => entry.ref === 'provider').atomId =
    registryBundle.registry.terms['predicate:has-trust-provider'].termIds.testnet
  const result = validatePlan(plan, registryBundle)
  assert.equal(result.valid, false)
  assert.match(result.errors.join('\n'), /controlled registry term/)
})

test('validator rejects create/reuse overlap for the agent', async () => {
  const input = baseInput()
  const plan = buildPlan(input, registryBundle, await foundEvidence(input))
  plan.atomCreations.unshift({
    ref: 'agent',
    purpose: 'identity-specific',
    encoding: 'pinThing',
    creationPolicy: 'identity-specific',
    resolvePinnedUriBeforeMint: true,
    thing: { name: 'Other Agent', description: 'Orphan', image: '', url: 'https://agent.example' },
  })
  const result = validatePlan(plan, registryBundle)
  assert.equal(result.valid, false)
  assert.match(result.errors.join('\n'), /cannot be both created and reused/)
})

test('validator rejects post-build resolver and identity tampering', async () => {
  const input = baseInput()
  const plan = buildPlan(input, registryBundle, await foundEvidence(input))
  plan.assessment.resolverUrl = 'https://attacker.example/assessment.json'
  plan.identity.tokenId = '999'
  const result = validatePlan(plan, registryBundle)
  assert.equal(result.valid, false)
  assert.match(result.errors.join('\n'), /identity CAIP fields are invalid or inconsistent/)
  assert.match(result.errors.join('\n'), /assessment source Thing URL must equal/)
})

test('validator rejects altered identity and agent construction', async () => {
  const input = baseInput()
  input.agent.registrationFile = { name: 'Example Agent' }
  const plan = buildPlan(input, registryBundle, await missingEvidence(input))
  plan.atomCreations.find((entry) => entry.ref === 'identityObject').thing.description = 'close enough'
  plan.atomCreations.find((entry) => entry.ref === 'agent').thing.name = 'Different Agent'
  const result = validatePlan(plan, registryBundle)
  assert.equal(result.valid, false)
  assert.match(result.errors.join('\n'), /exact canonical CAIP Thing recipe/)
  assert.match(result.errors.join('\n'), /exact canonical registration-file recipe/)
})

test('validator rejects duplicate refs, reversed triples, and altered creation policy', async () => {
  const input = baseInput()
  const plan = buildPlan(input, registryBundle, await foundEvidence(input))
  plan.atomCreations.push(structuredClone(plan.atomCreations[0]))
  plan.atomCreations[0].purpose = 'identity-specific'
  plan.triples.reverse()
  const result = validatePlan(plan, registryBundle)
  assert.equal(result.valid, false)
  assert.match(result.errors.join('\n'), /atom creation refs must be unique/)
  assert.match(result.errors.join('\n'), /purpose and creationPolicy/)
  assert.match(result.errors.join('\n'), /triples\[0\] must be trust-provider/)
})

test('planner rejects unsafe entity variants after live preflight', async () => {
  const raw = baseInput()
  const preflight = await foundEvidence(raw)
  raw.provider = 'Acme Trust'
  assert.throws(() => buildPlan(raw, registryBundle, preflight), /manifest.provider must be an object/)

  const mismatch = baseInput()
  const mismatchPreflight = await foundEvidence(mismatch)
  mismatch.assessmentSource.thing.url = 'https://acme.example/wrong.json'
  assert.throws(() => buildPlan(mismatch, registryBundle, mismatchPreflight), (error) => {
    assert.equal(error.code, 'resolver_url_mismatch')
    return true
  })

  const privateTarget = baseInput()
  const privatePreflight = await foundEvidence(privateTarget)
  privateTarget.assessmentSource.resolverUrl = 'https://169.254.169.254/latest/meta-data'
  privateTarget.assessmentSource.thing.url = privateTarget.assessmentSource.resolverUrl
  assert.throws(() => buildPlan(privateTarget, registryBundle, privatePreflight), (error) => {
    assert.equal(error.code, 'private_url_forbidden')
    return true
  })

  const mappedPrivateTarget = baseInput()
  const mappedPrivatePreflight = await foundEvidence(mappedPrivateTarget)
  mappedPrivateTarget.assessmentSource.resolverUrl = 'https://[::ffff:169.254.169.254]/latest/meta-data'
  mappedPrivateTarget.assessmentSource.thing.url = mappedPrivateTarget.assessmentSource.resolverUrl
  assert.throws(() => buildPlan(mappedPrivateTarget, registryBundle, mappedPrivatePreflight), (error) => {
    assert.equal(error.code, 'private_url_forbidden')
    return true
  })
})

test('planner reports all missing Thing fields in one correction cycle', async () => {
  const input = baseInput()
  const preflight = await foundEvidence(input)
  input.provider.thing = {
    name: 'Acme Trust',
    url: 'https://acme.example',
  }
  assert.throws(() => buildPlan(input, registryBundle, preflight), (error) => {
    assert.equal(error.code, 'missing_thing_fields')
    assert.deepEqual(error.details?.missingFields, ['description', 'image'])
    return true
  })
})

test('production CLI parser rejects registry overrides', () => {
  assert.throws(() => parseCliArgs(['--registry', '/tmp/attacker.json']), (error) => {
    assert.equal(error.code, 'registry_override_forbidden')
    return true
  })
})

test('planner CLI accepts an explicit canonical artifact output path', () => {
  const args = parseCliArgs([
    '--input', '/tmp/manifest.json',
    '--output', '/tmp/partner.semantic-plan.json',
  ], { allowOutput: true })
  assert.equal(args.input, '/tmp/manifest.json')
  assert.equal(args.output, '/tmp/partner.semantic-plan.json')

  assert.throws(() => parseCliArgs(['--output'], { allowOutput: true }), (error) => {
    assert.equal(error.code, 'missing_argument_value')
    return true
  })

  assert.throws(() => parseCliArgs(['--input', '--compact']), (error) => {
    assert.equal(error.code, 'missing_argument_value')
    return true
  })

  assert.throws(() => parseCliArgs(['--output', '--offline'], {
    allowOffline: true,
    allowOutput: true,
  }), (error) => {
    assert.equal(error.code, 'missing_argument_value')
    return true
  })
})

test('planner and validator reject programmatic custom registries', async () => {
  const custom = structuredClone(registryBundle)
  custom.registry.terms['predicate:has-trust-provider'].termIds.testnet = id('a')
  assert.throws(() => buildPlan(baseInput(), custom), (error) => {
    assert.equal(error.code, 'registry_bundle_mismatch')
    return true
  })
  const plan = buildPlan(baseInput(), registryBundle)
  const result = validatePlan(plan, custom)
  assert.equal(result.valid, false)
  assert.match(result.errors.join('\n'), /pinned bundled ERC-8004 registry/)
})

test('registry uses identical resolve-only IDs on both networks', () => {
  const keys = registryTermKeys(registryBundle.registry)
  assert.equal(keys.length, 86)
  for (const key of keys) {
    const mainnet = registryTermDescriptor(registryBundle.registry, 'mainnet', key)
    const testnet = registryTermDescriptor(registryBundle.registry, 'testnet', key)
    assert.equal(mainnet.createPolicy, 'resolve-only')
    assert.equal(testnet.createPolicy, 'resolve-only')
    if (key === 'predicate:has-tag') assert.notEqual(mainnet.termId, testnet.termId)
    else assert.equal(mainnet.termId, testnet.termId)
  }
})

test('partner-facing docs expose the canonical guide and later pinning boundary', () => {
  assert.match(readmeText, /self-contained for semantic planning/i)
  assert.match(readmeText, /https:\/\/docs\.intuition\.systems\/docs\/erc-8004-agent-layer/)
  assert.match(workflowText, /configureSdk\(\{ pinApiKey \}\)/)
  assert.match(workflowText, /never hardcode/i)
  assert.match(workflowText, /create-if-missing candidates/i)
  assert.match(workflowText, /A2A Agent.*Unknown/is)
})

test('mainnet semantic plan stays dry, unauthorized, and unencoded', async () => {
  const input = baseInput()
  input.network = 'mainnet'
  const plan = buildPlan(input, registryBundle, await foundEvidence(input))
  assert.equal(plan.status, 'semantic_plan_ready')
  assert.equal(plan.safety.pinningAllowed, false)
  assert.equal(plan.safety.protocolPreparationAllowed, false)
  assert.equal(plan.safety.unsignedEncodingAllowed, false)
  assert.equal(plan.safety.signingAllowed, false)
  assert.equal(plan.safety.broadcastAllowed, false)
  assert.equal(plan.safety.mainnetConfirmationRequired, true)
  assert.equal(plan.handoff.phase, 'semantic-planning')
  assert.equal(plan.handoff.terminal, true)
  assert.equal(plan.handoff.nextAction, 'return-plan-and-stop')
  assert.equal(plan.handoff.requiresNewUserRequestForProtocolPreparation, true)
  assert.equal(plan.handoff.readyForProtocolPreparation, false)
  assert.equal(plan.handoff.authorization, 'not-granted')
  assert.equal(plan.handoff.readyForUnsignedEncoding, false)
  assert.equal(plan.networkConfig.chainId, 1155)
  assert.equal(validatePlan(plan, registryBundle).valid, true)
})

test('network selection never grants ERC-8004 execution authority', async () => {
  for (const network of ['testnet', 'mainnet']) {
    const input = baseInput()
    input.network = network
    const plan = buildPlan(input, registryBundle, await foundEvidence(input))
    assert.equal(plan.handoff.phase, 'semantic-planning')
    assert.equal(plan.handoff.authorization, 'not-granted')
    assert.equal(plan.handoff.requiresNewUserRequestForProtocolPreparation, true)
    assert.equal(plan.safety.pinningAllowed, false)
    assert.equal(plan.safety.protocolPreparationAllowed, false)
    assert.equal(plan.safety.unsignedEncodingAllowed, false)
    assert.equal(plan.safety.signingAllowed, false)
    assert.equal(plan.safety.broadcastAllowed, false)
    assert.equal(validatePlan(plan, registryBundle).valid, true)
  }
})

test('approval specification preserves every non-transitive escalation stage', () => {
  for (const stage of [
    'semantic-planning',
    'protocol-preview',
    'metadata-pinning',
    'testnet-execution',
    'mainnet-preview',
    'mainnet-execution',
  ]) {
    assert.match(skillText, new RegExp(`\\b${stage}\\b`))
    assert.match(workflowText, new RegExp(`\\b${stage}\\b`))
  }
  assert.match(skillText, /Authorization is non-transitive/)
  assert.match(workflowText, /always uses the core skill's `manual-review` mode/)
  assert.match(workflowText, /Do not honor `autoApproveUpToWei`/)
  assert.match(workflowText, /Chain `13579` only/)
  assert.match(workflowText, /Chain `1155` only/)
  assert.match(workflowText, /approval expires after one use/g)
  assert.match(skillText, /General delegation such as “pin anything missing”/)
  assert.match(skillText, /Never infer\s+pinning approval by opening a plan/)
  assert.match(workflowText, /explicitly approve\s+that presented request in a new message/)
  assert.match(workflowText, /Do not construct the approval scope and consume the user's earlier broad\s+instruction in the same turn/)
})
