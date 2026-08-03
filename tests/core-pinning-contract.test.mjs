import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

async function read(relativePath) {
  return readFile(resolve(repoRoot, relativePath), 'utf8')
}

test('core skill routes pinThing through a configured SDK capability', async () => {
  const [skill, schemas, graphql] = await Promise.all([
    read('skills/intuition/SKILL.md'),
    read('skills/intuition/reference/schemas.md'),
    read('skills/intuition/reference/graphql-queries.md'),
  ])

  assert.match(skill, /@0xintuition\/sdk` 3\.0\.1 or newer/)
  assert.match(skill, /configureSdk\(\{ pinApiKey \}\)/)
  assert.match(schemas, /https:\/\/pin\.intuition\.systems\/v1\/graphql/)
  assert.match(schemas, /\$GRAPHQL` from session\s+setup is read-only/)
  assert.match(graphql, /\$GRAPHQL` endpoint is read-only/)

  assert.doesNotMatch(
    schemas,
    /All three mutations use the same `\$GRAPHQL` endpoint/,
  )
  assert.doesNotMatch(graphql, /\$GRAPHQL` endpoint also supports \*\*pin mutations/)
})

test('missing pinning configuration fails closed without requesting a secret', async () => {
  const [skill, schemas, prompts] = await Promise.all([
    read('skills/intuition/SKILL.md'),
    read('skills/intuition/reference/schemas.md'),
    read('tests/prompts/b1-pin-prompts.md'),
  ])

  for (const content of [skill, schemas, prompts]) {
    assert.match(content, /pinning_configuration_required/)
  }

  assert.match(skill, /Do not attempt the request/)
  assert.match(skill, /ask the user to paste a key/)
  assert.match(prompts, /without attempting a pin request/)
  assert.match(prompts, /No pinning request or transaction fields/)
})

test('human guidance keeps the pinning key in trusted application storage', async () => {
  const readme = await read('skills/intuition/README.md')

  assert.match(readme, /gitignored `\.env\.local` or `\.env`/)
  assert.match(readme, /encrypted secret\s+manager/)
  assert.match(readme, /outside\s+the installed skill directory/)
  assert.match(readme, /Never put it in a prompt/)
  assert.match(readme, /NEXT_PUBLIC_\*` \/ `VITE_\*`/)
})
