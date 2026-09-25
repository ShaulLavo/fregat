#!/usr/bin/env node
import { appendFileSync, existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * A GitLab CLI stand-in for scenarios: signed in, no merge request until `mr create` runs, then
 * one open merge request for the branch it was created from. Invocations go to `calls.jsonl`.
 */
const root = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
appendFileSync(join(root, 'calls.jsonl'), `${JSON.stringify(args)}\n`)
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
