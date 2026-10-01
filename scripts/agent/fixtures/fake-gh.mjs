#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * A GitHub CLI stand-in for scenarios: signed in, one repository, and pull requests read from
 * `forge.json` beside it (`{ "branches": { "<head>": { number, title, url, state, isDraft } } }`,
 * where the head `*` answers for any branch), and `gh pr view <n>` from its `pullRequests`.
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
if (
  args[0] === 'api' &&
  args.some((arg) => /^repos\/[^/]+\/[^/]+\/issues\/\d+\/comments/.test(arg))
) {
  const data = forge()
  const comments = data.comments ?? []
  if (args.includes('POST')) {
    if (data.failComment) {
      process.stderr.write('fixture comment refusal\n')
      process.exit(1)
    }
    const { body } = JSON.parse(readFileSync(0, 'utf8'))
    const id = comments.length + 1
    comments.push({
      id,
      body,
      user: { login: 'reviewer' },
      created_at: '2026-10-01T10:00:00Z',
      html_url: `https://github.com/fregat/fixture/pull/7#issuecomment-${id}`,
    })
    writeFileSync(join(root, 'forge.json'), JSON.stringify({ ...data, comments }))
    out(comments.at(-1))
  } else out(comments)
  process.exit(0)
}
if (
  args[0] === 'api' &&
  args.includes('POST') &&
  args.some((arg) => /^repos\/[^/]+\/[^/]+\/pulls\/\d+\/reviews$/.test(arg))
) {
  const data = forge()
  if (data.failReview) {
    process.stderr.write('fixture review refusal\n')
    process.exit(1)
  }
  const review = JSON.parse(readFileSync(0, 'utf8'))
  const reviews = [...(data.reviews ?? []), review]
  writeFileSync(join(root, 'forge.json'), JSON.stringify({ ...data, reviews }))
  out({ id: reviews.length, ...review })
  process.exit(0)
}
if (args[0] === 'api' && !args.includes('POST')) {
  const endpoint = args.find((arg) => /^repos\/[^/]+\/[^/]+\/pulls\/\d+\//.test(arg)) ?? ''
  const data = forge()
  if (endpoint.includes('/reviews?')) {
    out([
      ...(data.activityReviews ?? []),
      ...(data.reviews ?? []).map((review, index) => ({
        id: index + 100,
        body: review.body,
        state: review.event === 'APPROVE' ? 'APPROVED' : review.event,
        user: { login: 'reviewer' },
        submitted_at: '2026-10-01T11:00:00Z',
      })),
    ])
    process.exit(0)
  }
  if (endpoint.includes('/commits?')) {
    out(data.activityCommits ?? [])
    process.exit(0)
  }
  if (endpoint.includes('/comments?')) {
    out(data.activityDiscussions ?? [])
    process.exit(0)
  }
}
if (args[0] === 'api' && args[1] === 'graphql') {
  const branches = forge().branches ?? {}
  const repository = {}
  for (let index = 0; index < args.length; index += 1) {
    const number = /^n(\d+)=(\d+)$/.exec(args[index] ?? '')
    if (args[index - 1] === '-F' && number) {
      repository[`p${number[1]}`] = forge().pullRequests?.[number[2]] ?? null
      continue
    }
    const match = /^h(\d+)=(.*)$/s.exec(args[index] ?? '')
    if (args[index - 1] !== '-f' || !match) continue
    const pullRequest = branches[match[2]] ?? branches['*']
    repository[`b${match[1]}`] = { nodes: pullRequest ? [pullRequest] : [] }
  }
  out({ data: { repository } })
  process.exit(0)
}
if (args[0] === 'pr' && args[1] === 'view') {
  const pullRequest = forge().pullRequests?.[args[2]]
  if (!pullRequest) {
    process.stderr.write(`no pull requests found for ${args[2]}\n`)
    process.exit(1)
  }
  out(pullRequest)
  process.exit(0)
}
if (args[0] === 'pr' && args[1] === 'list') {
  const head = args[args.indexOf('--head') + 1]
  const branches = forge().branches ?? {}
  const pullRequest = branches[head] ?? branches['*']
  // A malformed answer goes out as it is, so the caller has to treat it as a failed read.
  const malformed = pullRequest && typeof pullRequest.number !== 'number'
  out(pullRequest && (malformed || pullRequest.state === 'OPEN') ? [pullRequest] : [])
  process.exit(0)
}
process.stderr.write(`fake gh: unsupported ${args.join(' ')}\n`)
process.exit(1)
