#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * A GitHub CLI stand-in for scenarios: signed in, one repository, and pull requests read from
 * `forge.json` beside it (`{ "branches": { "<head>": { number, title, url, state, isDraft } } }`,
 * where the head `*` answers for any branch).
 * Every invocation is appended to `calls.jsonl` so a scenario can count requests.
 */
const root = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
appendFileSync(join(root, 'calls.jsonl'), `${JSON.stringify(args)}\n`)
const forge = () => JSON.parse(readFileSync(join(root, 'forge.json'), 'utf8'))
const out = (value) => process.stdout.write(`${JSON.stringify(value)}\n`)

if (args[0] === 'auth' && args[1] === 'status') process.exit(0)
if (args[0] === 'repo' && args[1] === 'create') {
  process.stdout.write(`https://github.com/${args[2]}\n`)
  process.exit(0)
}
if (args[0] === 'repo' && args[1] === 'view') {
  out({ owner: { login: 'fregat' }, name: 'fixture' })
  process.exit(0)
}
if (args[0] === 'api' && args[1] === 'graphql') {
  const branches = forge().branches ?? {}
  const repository = {}
  for (let index = 0; index < args.length; index += 1) {
    const match = /^h(\d+)=(.*)$/s.exec(args[index] ?? '')
    if (args[index - 1] !== '-f' || !match) continue
    const pullRequest = branches[match[2]] ?? branches['*']
    repository[`b${match[1]}`] = { nodes: pullRequest ? [pullRequest] : [] }
  }
  out({ data: { repository } })
  process.exit(0)
}
if (args[0] === 'pr' && args[1] === 'list') {
  const head = args[args.indexOf('--head') + 1]
  const pullRequest = forge().branches?.[head]
  out(pullRequest && pullRequest.state === 'OPEN' ? [pullRequest] : [])
  process.exit(0)
}
process.stderr.write(`fake gh: unsupported ${args.join(' ')}\n`)
process.exit(1)
