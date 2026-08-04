#!/usr/bin/env node

import { writeFile } from 'node:fs/promises'

import {
  buildPlan,
  errorPayload,
  loadRegistry,
  parseCliArgs,
  PlanError,
  printJson,
  readJsonSource,
  revalidatePlanPreflight,
  resolveAgentPreflight,
  validatePlan,
} from './partner-plan.mjs'

function usage() {
  return `Build and validate a deterministic ERC-8004 partner integration plan.

Usage:
  node build-partner-plan.mjs --input <manifest.json> [--output <result.json>] [--preflight-only | --offline] [--compact]
  cat manifest.json | node build-partner-plan.mjs

By default the command performs a read-only identity preflight with bounded
transient retries, builds the plan, validates every invariant, and repeats the
identity read before emitting the unmodified canonical plan.
--output writes the complete result to one file and prints a compact receipt.
--preflight-only returns the live identity result without requiring partner metadata.
--offline emits the canonical preflight request without executing it.
The command never pins, reads write costs, prepares calldata, signs, broadcasts,
or creates shared vocabulary.`
}

async function emitResult(value, args) {
  if (!args.output) {
    printJson(value, args.pretty)
    return
  }
  await writeFile(args.output, `${JSON.stringify(value, null, args.pretty ? 2 : 0)}\n`, 'utf8')
  printJson({
    status: 'planning_result_saved',
    resultStatus: value.status,
    artifactType: value.artifact?.type ?? 'erc8004-preflight-result',
    output: args.output,
    integritySha256: value.integrity?.sha256 ?? null,
    phase: value.handoff?.phase ?? 'semantic-planning',
    terminal: value.handoff?.terminal ?? true,
    nextAction: value.handoff?.nextAction ?? 'return-result-and-stop',
  }, true)
}

let preflightEvidence
try {
  const args = parseCliArgs(process.argv.slice(2), {
    allowOffline: true,
    allowPreflightOnly: true,
    allowOutput: true,
  })
  if (args.help) {
    process.stdout.write(`${usage()}\n`)
    process.exit(0)
  }
  const [input, registryBundle] = await Promise.all([
    readJsonSource(args.input),
    loadRegistry(),
  ])
  if (args.offline && args.preflightOnly) throw new Error('--offline and --preflight-only are mutually exclusive')
  preflightEvidence = args.offline ? undefined : await resolveAgentPreflight(input, registryBundle)
  if (args.preflightOnly) {
    await emitResult({
      status: 'preflight_complete',
      network: input.network,
      agent: { chainId: input.agent.chainId, tokenId: String(input.agent.tokenId) },
      preflightEvidence,
      writesAllowed: false,
    }, args)
  } else {
    const plan = buildPlan(input, registryBundle, preflightEvidence)
    const structural = validatePlan(plan, registryBundle)
    if (!structural.valid) {
      throw new PlanError('generated_plan_invalid', 'The canonical planner generated an invalid plan', {
        errors: structural.errors,
      })
    }
    const livePreflight = await revalidatePlanPreflight(plan, registryBundle)
    if (!livePreflight.valid) {
      throw new PlanError('fresh_preflight_mismatch', 'The plan no longer matches a fresh canonical identity query', {
        errors: livePreflight.errors,
      })
    }
    await emitResult(plan, args)
  }
} catch (error) {
  const payload = errorPayload(error)
  if (preflightEvidence) payload.preflightEvidence = preflightEvidence
  printJson(payload, true, process.stderr)
  process.exit(1)
}
