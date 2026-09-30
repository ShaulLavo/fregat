export const REPOSITORY_OWNER = 'ShaulLavo'
export const REPOSITORY_NAME = 'singapore'
const REPOSITORY_BRANCH = 'main'

const COMMIT_ENDPOINT = `https://api.github.com/repos/${REPOSITORY_OWNER}/${REPOSITORY_NAME}/commits/${REPOSITORY_BRANCH}`
const FETCH_CONCURRENCY = 8

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

type GitHubTreeResponse = {
  readonly sha?: unknown
  readonly tree?: unknown
  readonly truncated?: unknown
}

type GitHubCommitResponse = {
  readonly sha?: unknown
  readonly commit?: {
    readonly tree?: {
      readonly sha?: unknown
    }
  }
}

type GitHubTreeItem = {
  readonly path?: unknown
  readonly type?: unknown
  readonly sha?: unknown
  readonly size?: unknown
}

export type SourceFile = {
  readonly path: string
  readonly sha: string
  readonly size: number
  readonly text: string
}

export type SourceSnapshot = {
  readonly owner: string
  readonly repo: string
  readonly branch: string
  readonly commitSha: string
  readonly treeSha: string
  readonly fetchedAt: number
  readonly files: readonly SourceFile[]
}

export type RepositorySourceRef = {
  readonly commitSha: string
  readonly treeSha: string
}

export async function fetchRepositorySource(
  sourceRef?: RepositorySourceRef,
): Promise<SourceSnapshot> {
  const resolvedRef = sourceRef ?? (await fetchRepositoryRef())
  const tree = await fetchRepositoryTree(resolvedRef.treeSha)
  const entries = parseTreeEntries(tree)
  const files = await mapWithConcurrency(entries, FETCH_CONCURRENCY, (entry) =>
    fetchSourceFile(resolvedRef.commitSha, entry),
  )

  return {
    owner: REPOSITORY_OWNER,
    repo: REPOSITORY_NAME,
    branch: REPOSITORY_BRANCH,
    commitSha: resolvedRef.commitSha,
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

export async function fetchRepositoryRef(): Promise<RepositorySourceRef> {
  const response = await fetch(COMMIT_ENDPOINT)
  if (!response.ok) throw new Error(`GitHub commit fetch failed: ${response.status}`)

  const body = (await response.json()) as GitHubCommitResponse
  if (typeof body.sha !== 'string') throw new Error('GitHub commit response missing sha')
  if (typeof body.commit?.tree?.sha !== 'string')
    throw new Error('GitHub commit response missing tree sha')

  return {
    commitSha: body.sha,
    treeSha: body.commit.tree.sha,
  }
}

async function fetchRepositoryTree(
  treeSha: string,
): Promise<{ readonly sha: string; readonly tree: unknown[] }> {
  const response = await fetch(treeEndpoint(treeSha))
  if (!response.ok) throw new Error(`GitHub tree fetch failed: ${response.status}`)

  const body = (await response.json()) as GitHubTreeResponse
  if (body.truncated === true) throw new Error('GitHub tree response was truncated')
  if (typeof body.sha !== 'string') throw new Error('GitHub tree response missing sha')
  if (!Array.isArray(body.tree)) throw new Error('GitHub tree response missing tree')

  return { sha: body.sha, tree: body.tree }
}

function parseTreeEntries(tree: { readonly tree: readonly unknown[] }): GitHubTreeFileEntry[] {
  const entries: GitHubTreeFileEntry[] = []

  for (const item of tree.tree) {
    const entry = parseTreeFileEntry(item)
    if (!entry) continue
    entries.push(entry)
  }

  return entries.toSorted((left, right) => left.path.localeCompare(right.path))
}

function parseTreeFileEntry(item: unknown): GitHubTreeFileEntry | null {
  const entry = item as GitHubTreeItem
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

type GitHubTreeFileEntry = {
  readonly path: string
  readonly sha: string
  readonly size: number
}

async function fetchSourceFile(ref: string, entry: GitHubTreeFileEntry): Promise<SourceFile> {
  const response = await fetch(sourceFileRawUrl(entry.path, ref))
  if (!response.ok) throw new Error(`GitHub raw fetch failed for ${entry.path}: ${response.status}`)

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

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = Array.from<R | undefined>({ length: items.length })
  let nextIndex = 0

  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex
      nextIndex += 1
      if (index >= items.length) return
      results[index] = await mapper(items[index]!)
    }
  }

  const workerCount = Math.min(concurrency, items.length)
  await Promise.all(Array.from({ length: workerCount }, worker))
  return results as R[]
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
