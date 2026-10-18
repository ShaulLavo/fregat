import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const updater = '.github/workflows/editor-tree-sitter-x.yml'
const ci = '.github/workflows/ci.yml'
const bot = 41898282
const prefix = 'tree-sitter-x/auto/'
const sha = /^[0-9a-f]{40}$/
const manifests = new Set([
  'package.json',
  'editor/package.json',
  'editor/site/package.json',
  'scripts/release/editor-fixture.json',
])
const generated = new Set([
  'bun.lock',
  'editor/packages/tree-sitter-languages/languages.json',
  'editor/packages/tree-sitter-languages/languages.lock.json',
  'editor/packages/tree-sitter-languages/NOTICE',
  'editor/packages/tree-sitter-languages/src/catalog.generated.ts',
  'editor/packages/tree-sitter-languages/src/metadata.ts',
])

function pinBranch(branch) {
  return new RegExp(`^${prefix}([0-9a-f]{40})-([0-9a-f]{40})$`).exec(branch)
}

function allowedFile(file) {
  return (
    manifests.has(file) ||
    generated.has(file) ||
    /^editor\/packages\/[^/]+\/package.json$/.test(file)
  )
}

function nativePull(pull, repository) {
  return (
    pull.user?.id === bot &&
    pull.user?.login === 'github-actions[bot]' &&
    pull.user?.type === 'Bot' &&
    pull.head?.repo?.full_name === repository &&
    pull.base?.repo?.full_name === repository &&
    pull.base?.ref === 'main' &&
    sha.test(pull.head?.sha) &&
    pinBranch(pull.head?.ref) &&
    !pull.draft
  )
}

// The artifact is an exact-head receipt from this updater on main. PR metadata cannot grant trust.
async function hasReceipt(api, repository, head) {
  const name = `tree-sitter-pin-${head}`
  const artifacts = await api.pages(`actions/artifacts?name=${name}&per_page=100`, 'artifacts')
  for (const artifact of artifacts) {
    if (artifact.name !== name || artifact.expired || !artifact.workflow_run?.id) continue
    const run = await api.get(`actions/runs/${artifact.workflow_run.id}`)
    if (run.path !== updater || run.head_branch !== 'main' || run.status !== 'completed') continue
    if (run.conclusion !== 'success' || run.repository?.full_name !== repository) continue
    if (!['schedule', 'workflow_dispatch'].includes(run.event)) continue
    return true
  }
  return false
}

async function allowedPull(api, repository, pull) {
  if (!nativePull(pull, repository)) return false
  const files = await api.pages(`pulls/${pull.number}/files?per_page=100`)
  return (
    files.length > 0 &&
    files.every(
      (file) => file.status === 'modified' && allowedFile(file.filename) && !file.previous_filename,
    )
  )
}

async function trustedPull(api, repository, pull) {
  if (!(await allowedPull(api, repository, pull))) return false
  return hasReceipt(api, repository, pull.head.sha)
}

async function fullCi(api, repository, pull) {
  const runs = await api.pages(
    `actions/workflows/ci.yml/runs?head_sha=${pull.head.sha}&event=workflow_dispatch&per_page=100`,
    'workflow_runs',
  )
  const run = runs.find(
    (candidate) =>
      candidate.head_sha === pull.head.sha &&
      candidate.head_branch === pull.head.ref &&
      candidate.event === 'workflow_dispatch' &&
      candidate.path === ci &&
      candidate.repository?.full_name === repository,
  )
  if (!run || run.status !== 'completed' || run.conclusion !== 'success') return false
  const jobs = await api.pages(`actions/runs/${run.id}/jobs?filter=latest&per_page=100`, 'jobs')
  const verdicts = jobs.filter((job) => job.name === 'CI')
  if (verdicts.length !== 1) return false
  const verdict = verdicts[0]
  return (
    verdict.status === 'completed' &&
    verdict.conclusion === 'success' &&
    verdict.head_sha === pull.head.sha &&
    verdict.run_id === run.id &&
    verdict.run_attempt === run.run_attempt
  )
}

async function closeObsolete(api, repository, pulls, keep) {
  for (const pull of pulls) {
    if (pull.number === keep || pull.state !== 'open') continue
    if (!(await allowedPull(api, repository, pull))) continue
    const current = await api.get(`pulls/${pull.number}`)
    if (
      current.state !== 'open' ||
      current.head.sha !== pull.head.sha ||
      !nativePull(current, repository)
    )
      continue
    await api.write(`pulls/${pull.number}`, 'PATCH', { state: 'closed' })
  }
}

export async function mergePins({ api, repository, event }) {
  // Read the run from GitHub, not a PR-supplied payload or downloaded CI artifact.
  const completed = await api.get(`actions/runs/${event.workflow_run.id}`)
  if (
    completed.repository?.full_name !== repository ||
    completed.status !== 'completed' ||
    completed.conclusion !== 'success'
  )
    return
  const isCi =
    completed.path === ci &&
    completed.event === 'workflow_dispatch' &&
    pinBranch(completed.head_branch)
  const isUpdater =
    completed.path === updater &&
    completed.head_branch === 'main' &&
    ['schedule', 'workflow_dispatch'].includes(completed.event)
  if (!isCi && !isUpdater) return
  const pulls = await api.pages('pulls?state=open&base=main&per_page=100')
  for (const pull of pulls) {
    if (isCi && (pull.head?.sha !== completed.head_sha || pull.head?.ref !== completed.head_branch))
      continue
    if (!(await trustedPull(api, repository, pull)) || !(await fullCi(api, repository, pull)))
      continue
    const current = await api.get(`pulls/${pull.number}`)
    if (
      current.state !== 'open' ||
      current.head.sha !== pull.head.sha ||
      !nativePull(current, repository)
    )
      continue
    // GitHub's expected SHA makes the final head comparison atomic with the merge.
    await api.write(`pulls/${pull.number}/merge`, 'PUT', {
      merge_method: 'squash',
      sha: pull.head.sha,
    })
  }
}

function shellGit(cwd, index) {
  return (args, input) =>
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null'].concat(args), {
      cwd,
      input,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env,
        GIT_INDEX_FILE: index,
        GIT_AUTHOR_NAME: 'github-actions[bot]',
        GIT_COMMITTER_NAME: 'github-actions[bot]',
        GIT_AUTHOR_EMAIL: '41898282+github-actions[bot]@users.noreply.github.com',
        GIT_COMMITTER_EMAIL: '41898282+github-actions[bot]@users.noreply.github.com',
      },
    }).trim()
}

function validateManifests(git, files, metadata) {
  for (const file of files) {
    if (!file.endsWith('/package.json') && !manifests.has(file)) continue
    const expected = git(['show', `HEAD:${file}`]).replace(
      /github:ShaulLavo\/tree-sitter-(x|md)#[0-9a-f]{40}/g,
      (_, parser) =>
        `github:ShaulLavo/tree-sitter-${parser}#${parser === 'x' ? metadata.runtime : metadata.markdown}`,
    )
    assert.deepEqual(
      JSON.parse(git(['show', `:${file}`])),
      JSON.parse(expected),
      'Manifest edits must contain only parser pin replacements to exact metadata SHAs',
    )
  }
}

export async function publishPins({ api, repository, directory, patch, metadata }) {
  assert.match(metadata.base, sha)
  assert.match(metadata.runtime, sha)
  assert.match(metadata.markdown, sha)
  const branch = `${prefix}${metadata.runtime}-${metadata.markdown}`
  const pulls = await api.pages('pulls?state=all&base=main&per_page=100')
  if (!patch.trim()) {
    await closeObsolete(api, repository, pulls)
    return null
  }
  const existing = pulls.find((pull) => nativePull(pull, repository) && pull.head.ref === branch)
  if (existing && existing.state !== 'open') return null
  if (existing && (await trustedPull(api, repository, existing))) {
    await closeObsolete(api, repository, pulls, existing.number)
    return { branch, head: existing.head.sha, number: existing.number }
  }
  const head = generatedHead({ directory, patch, metadata, branch })
  if (existing) assert.equal(existing.head.sha, head)
  let number = existing?.number
  if (!number) {
    const created = await api.write('pulls', 'POST', {
      base: 'main',
      head: branch,
      title: 'Update Tree-sitter and Markdown pins',
      body: `## Quick summary\n\nUpdates the editor's parser and matching Markdown grammar. This update merges automatically after full CI passes.\n\nRuntime: ${metadata.runtime}\nMarkdown: ${metadata.markdown}`,
    })
    number = created.number
  }
  await closeObsolete(api, repository, pulls, number)
  return { branch, head, number }
}

function generatedHead({ directory, patch, metadata, branch }) {
  let scratch
  try {
    scratch = mkdtempSync(join(tmpdir(), 'parser-pin-index-'))
    return commitGenerated(shellGit(directory, join(scratch, 'index')), patch, metadata, branch)
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true })
  }
}

function commitGenerated(git, patch, metadata, branch) {
  assert.equal(git(['rev-parse', 'HEAD']), metadata.base)
  git(['read-tree', metadata.base])
  git(['apply', '--cached', '--whitespace=error', '-'], patch)
  const files = git(['diff', '--cached', '--name-only']).split('\n')
  assert.ok(
    files.length > 0 && files.every(allowedFile),
    'Pin updates must change only pin inputs and generated files',
  )
  assert.ok(
    git(['diff', '--cached', '--name-status'])
      .split('\n')
      .every((line) => line.startsWith('M\t')),
    'Pin updates must modify existing files',
  )
  validateManifests(git, files, metadata)
  const manifest = JSON.parse(git(['show', ':editor/packages/tree-sitter/package.json']))
  assert.equal(
    manifest.dependencies['web-tree-sitter'],
    `github:ShaulLavo/tree-sitter-x#${metadata.runtime}`,
  )
  assert.equal(
    manifest.dependencies['tree-sitter-md'],
    `github:ShaulLavo/tree-sitter-md#${metadata.markdown}`,
  )
  const tree = git(['write-tree'])
  const remote = git(['ls-remote', 'origin', `refs/heads/${branch}`]).split(/\s/)[0]
  let head = remote
  if (remote) {
    git(['fetch', '--no-write-fetch-head', 'origin', `refs/heads/${branch}`])
    assert.equal(
      git(['rev-parse', `${remote}^{tree}`]),
      tree,
      'Existing branch must match the generated tree',
    )
    assert.equal(
      git(['show', '-s', '--format=%P', remote]),
      metadata.base,
      'Existing branch must have the generated base',
    )
  } else {
    head = git(['commit-tree', tree, '-p', metadata.base], `Update Tree-sitter and Markdown pins\n`)
    git(['push', 'origin', `${head}:refs/heads/${branch}`])
  }
  return head
}

function github(repository) {
  const request = (path, method = 'GET', data) =>
    JSON.parse(
      execFileSync(
        'gh',
        ['api', `repos/${repository}/${path}`, '--method', method].concat(
          data ? ['--input', '-'] : [],
        ),
        {
          input: data ? JSON.stringify(data) : undefined,
          encoding: 'utf8',
          maxBuffer: 16 * 1024 * 1024,
        },
      ),
    )
  return {
    get: request,
    write: request,
    pages: (path, key) => {
      const pages = JSON.parse(
        execFileSync('gh', ['api', `repos/${repository}/${path}`, '--paginate', '--slurp'], {
          encoding: 'utf8',
          maxBuffer: 16 * 1024 * 1024,
        }),
      )
      return pages.flatMap((page) => (key ? page[key] : page))
    },
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repository = process.env.GITHUB_REPOSITORY
  assert.match(repository ?? '', /^[\w.-]+\/[\w.-]+$/)
  const api = github(repository)
  if (process.argv[2] === 'merge') {
    await mergePins({
      api,
      repository,
      event: JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')),
    })
  } else {
    assert.equal(process.argv[2], 'publish')
    const result = await publishPins({
      api,
      repository,
      directory: process.cwd(),
      patch: readFileSync('pin-update/update.patch', 'utf8'),
      metadata: JSON.parse(readFileSync('pin-update/metadata.json', 'utf8')),
    })
    if (result) {
      writeFileSync('pin-receipt.json', JSON.stringify(result))
      appendFileSync(process.env.GITHUB_OUTPUT, `branch=${result.branch}\nhead=${result.head}\n`)
    }
  }
}
