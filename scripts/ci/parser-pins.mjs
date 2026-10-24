import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const bot = 41898282
const branch = 'tree-sitter-x/updates'
const sha = /^[0-9a-f]{40}$/
const manifests = new Set([
  'package.json',
  'packages/singapore/package.json',
  'packages/singapore/site/package.json',
  'scripts/release/editor-fixture.json',
])
const generated = new Set([
  'bun.lock',
  'packages/singapore/packages/tree-sitter-languages/languages.json',
  'packages/singapore/packages/tree-sitter-languages/languages.lock.json',
  'packages/singapore/packages/tree-sitter-languages/NOTICE',
  'packages/singapore/packages/tree-sitter-languages/src/catalog.generated.ts',
  'packages/singapore/packages/tree-sitter-languages/src/metadata.ts',
])

function allowedFile(file) {
  return (
    manifests.has(file) ||
    generated.has(file) ||
    /^packages\/singapore\/packages\/[^/]+\/package.json$/.test(file)
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
    pull.head?.ref === branch &&
    !pull.draft
  )
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
  if (!patch.trim()) return null
  const owner = repository.split('/')[0]
  const pulls = await api.pages(
    `pulls?state=open&base=main&head=${encodeURIComponent(`${owner}:${branch}`)}&per_page=100`,
  )
  assert.ok(
    pulls.every((pull) => nativePull(pull, repository)),
    'Rolling PR must belong to the updater',
  )
  assert.ok(pulls.length <= 1, 'Expected at most one rolling PR')
  const head = generatedHead({ directory, patch, metadata, branch })
  const details = {
    title: 'Update Tree-sitter and Markdown pins',
    body: `## Quick summary\n\nUpdates the editor's parser and matching Markdown grammar. This PR stays open for manual review and merging.\n\nRuntime: ${metadata.runtime}\nMarkdown: ${metadata.markdown}`,
  }
  const existing = pulls[0]
  if (existing) {
    await api.write(`pulls/${existing.number}`, 'PATCH', details)
    return { branch, head, number: existing.number }
  }
  const created = await api.write('pulls', 'POST', { base: 'main', head: branch, ...details })
  return { branch, head, number: created.number }
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
  const manifest = JSON.parse(
    git(['show', ':packages/singapore/packages/tree-sitter/package.json']),
  )
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
    if (git(['rev-parse', `${remote}^{tree}`]) === tree) return remote
    const parents = remote === metadata.base ? ['-p', remote] : ['-p', remote, '-p', metadata.base]
    head = git(['commit-tree', tree].concat(parents), `Update Tree-sitter and Markdown pins\n`)
  } else {
    head = git(['commit-tree', tree, '-p', metadata.base], `Update Tree-sitter and Markdown pins\n`)
  }
  git(['push', 'origin', `${head}:refs/heads/${branch}`])
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
  assert.equal(process.argv[2], 'publish')
  const result = await publishPins({
    api,
    repository,
    directory: process.cwd(),
    patch: readFileSync('pin-update/update.patch', 'utf8'),
    metadata: JSON.parse(readFileSync('pin-update/metadata.json', 'utf8')),
  })
  if (result) {
    appendFileSync(process.env.GITHUB_OUTPUT, `branch=${result.branch}\nhead=${result.head}\n`)
  }
}
