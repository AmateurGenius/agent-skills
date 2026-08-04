#!/usr/bin/env node

import {
  errorPayload,
  loadRegistry,
  parseCliArgs,
  printJson,
  readJsonSource,
  revalidatePlanPreflight,
  validatePlan,
} from './partner-plan.mjs'

function usage() {
  return `Validate an ERC-8004 partner plan against the bundled canonical registry.

Usage:
  node validate-partner-plan.mjs --input <plan.json> [--compact]
  cat plan.json | node validate-partner-plan.mjs

Ready plans are rechecked against the live canonical identity query.
The command exits non-zero when the plan is unsafe, stale, or diverges from the registry.`
}

try {
  const args = parseCliArgs(process.argv.slice(2))
  if (args.help) {
    process.stdout.write(`${usage()}\n`)
    process.exit(0)
  }
  const [plan, registryBundle] = await Promise.all([
    readJsonSource(args.input),
    loadRegistry(),
  ])
  const structural = validatePlan(plan, registryBundle)
  const livePreflight = structural.valid
    ? await revalidatePlanPreflight(plan, registryBundle)
    : { valid: false, errors: [], skipped: true, reason: 'structural-validation-failed' }
  const errors = [...structural.errors, ...livePreflight.errors]
  const valid = structural.valid && livePreflight.valid
  printJson({ status: valid ? 'valid' : 'invalid', valid, errors, livePreflight }, args.pretty)
  if (!valid) process.exit(1)
} catch (error) {
  printJson(errorPayload(error), true, process.stderr)
  process.exit(1)
}
