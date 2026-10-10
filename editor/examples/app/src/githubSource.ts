import { createStructuredError } from './structured-errors.ts'

export const REPOSITORY_OWNER = 'ShaulLavo'
export const REPOSITORY_NAME = 'singapore'
const REPOSITORY_BRANCH = 'main'

const COMMIT_ENDPOINT = `https://api.github.com/repos/${REPOSITORY_OWNER}/${REPOSITORY_NAME}/commits/${REPOSITORY_BRANCH}`

const TEXT_EXTENSIONS = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.lock',
  '.md',
  '.markdown',
  '.mjs',
  '.scm',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
])

const TEXT_FILENAMES = new Set(['.gitignore'])

export type SourceFile = {
  readonly path: string
  readonly sha: string
  readonly size: number
  readonly text: string
}

export type SourceEntry = Pick<SourceFile, 'path' | 'sha' | 'size'>

export type SourceSnapshot = {
  readonly owner: string
  readonly repo: string
  readonly branch: string
  readonly commitSha: string
  readonly treeSha: string
  readonly fetchedAt: number
  readonly files: readonly SourceEntry[]
}

export type RepositorySourceRef = {
  readonly commitSha: string
  readonly treeSha: string
}

export async function fetchRepositorySource(
  sourceRef: RepositorySourceRef,
  signal?: AbortSignal,
): Promise<SourceSnapshot> {
  const tree = await fetchRepositoryTree(sourceRef.treeSha, signal)
  const files = parseTreeEntries(tree)

  return {
    owner: REPOSITORY_OWNER,
    repo: REPOSITORY_NAME,
    branch: REPOSITORY_BRANCH,
    commitSha: sourceRef.commitSha,
    treeSha: tree.sha,
    fetchedAt: Date.now(),
    files,
  }
}

export function sourceFileRawUrl(path: string, ref = REPOSITORY_BRANCH): string {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  return `${rawSourceBase(ref)}/${encodedPath}`
}

export function isSourceTextPath(path: string): boolean {
  if (TEXT_FILENAMES.has(fileName(path))) return true
  return TEXT_EXTENSIONS.has(extensionForPath(path))
}

export async function fetchRepositoryRef(signal?: AbortSignal): Promise<RepositorySourceRef> {
  const response = await fetch(COMMIT_ENDPOINT, { signal })
  if (!response.ok)
    throw createStructuredError('FETCH_FAILED', { operation: 'commit', status: response.status })

  const body: unknown = await response.json()
  if (
    !isRecord(body) ||
    typeof body.sha !== 'string' ||
    !isRecord(body.commit) ||
    !isRecord(body.commit.tree) ||
    typeof body.commit.tree.sha !== 'string'
  ) {
    throw createStructuredError('INVALID_RESPONSE', {
      operation: 'commit',
      expected: 'commit and tree ids',
    })
  }

  return {
    commitSha: body.sha,
    treeSha: body.commit.tree.sha,
  }
}

async function fetchRepositoryTree(
  treeSha: string,
  signal?: AbortSignal,
): Promise<{ readonly sha: string; readonly tree: unknown[] }> {
  const response = await fetch(treeEndpoint(treeSha), { signal })
  if (!response.ok)
    throw createStructuredError('FETCH_FAILED', { operation: 'tree', status: response.status })

  const body: unknown = await response.json()
  if (!isRecord(body) || typeof body.sha !== 'string' || !Array.isArray(body.tree)) {
    throw createStructuredError('INVALID_RESPONSE', {
      operation: 'tree',
      expected: 'tree id and entries',
    })
  }
  if (body.truncated === true) {
    throw createStructuredError('INVALID_RESPONSE', { operation: 'tree', truncated: true })
  }

  return { sha: body.sha, tree: body.tree }
}

function parseTreeEntries(tree: { readonly tree: readonly unknown[] }): SourceEntry[] {
  const entries: SourceEntry[] = []

  for (const item of tree.tree) {
    const entry = parseTreeFileEntry(item)
    if (!entry) continue
    entries.push(entry)
  }

  return entries.sort((left, right) => left.path.localeCompare(right.path))
}

function parseTreeFileEntry(item: unknown): SourceEntry | null {
  if (!isRecord(item)) return null
  const entry = item
  if (entry.type !== 'blob') return null
  if (typeof entry.path !== 'string') return null
  if (typeof entry.sha !== 'string') return null
  if (typeof entry.size !== 'number') return null
  if (!isSourceTextPath(entry.path)) return null

  return {
    path: entry.path,
    sha: entry.sha,
    size: entry.size,
  }
}

export async function fetchSourceFile(
  ref: string,
  entry: SourceEntry,
  signal?: AbortSignal,
): Promise<SourceFile> {
  const response = await fetch(sourceFileRawUrl(entry.path, ref), { signal })
  if (!response.ok)
    throw createStructuredError('FETCH_FAILED', { operation: 'file', status: response.status })

  return {
    ...entry,
    text: await response.text(),
  }
}

function treeEndpoint(treeSha: string): string {
  return `https://api.github.com/repos/${REPOSITORY_OWNER}/${REPOSITORY_NAME}/git/trees/${treeSha}?recursive=1`
}

function rawSourceBase(ref: string): string {
  return `https://raw.githubusercontent.com/${REPOSITORY_OWNER}/${REPOSITORY_NAME}/${ref}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function extensionForPath(path: string): string {
  const name = fileName(path)
  const dotIndex = name.lastIndexOf('.')
  if (dotIndex === -1) return ''
  return name.slice(dotIndex).toLowerCase()
}
