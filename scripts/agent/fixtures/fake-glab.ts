#!/usr/bin/env node
import { fixtureIO } from './runtime.ts'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A GitLab CLI stand-in for scenarios: signed in, no merge request until `mr create` runs, then
 * one open merge request for the branch it was created from. Invocations go to `calls.jsonl`.
 */
const { root, record } = fixtureIO(import.meta.url, 'calls.jsonl')
const args = process.argv.slice(2)
record(args)
const created = join(root, 'created')
const MERGE_REQUEST = {
  iid: 5,
  title: 'Merge request fixture',
  web_url: 'https://gitlab.com/fregat/fixture/-/merge_requests/5',
  state: 'opened',
  draft: false,
}

if (args[0] === 'auth' && args[1] === 'status') process.exit(0)
if (args[0] === 'mr' && args[1] === 'create') {
  writeFileSync(created, args[args.indexOf('--source-branch') + 1] ?? '')
  process.exit(0)
}
if (args[0] === 'mr' && args[1] === 'list') {
  const requests = existsSync(created) ? [MERGE_REQUEST] : []
  process.stdout.write(`${JSON.stringify(requests)}\n`)
  process.exit(0)
}
process.stderr.write(`fake glab: unsupported ${args.join(' ')}\n`)
process.exit(1)
