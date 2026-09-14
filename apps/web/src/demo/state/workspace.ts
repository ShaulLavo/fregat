import { createError } from 'evlog'
import type {
  FileSystemEntryMetadata,
  FileTreeEntry,
  GitFileDiff,
  GitFileStatus,
  GitHistoryCommit,
  GitRepositoryInfo,
  OrchestrationSession,
  SettingsSnapshot,
} from '@workspace/contracts'
import {
  DEMO_FILES,
  DEMO_ROOT,
  DEMO_TIME,
  seedProject,
  seedSession,
  seedSettings,
  seedWorktree,
} from '../seed'
import { fileDiff } from '../utils/git-diff'

export type DemoFile = { content: string; version: string; mtimeMs: number }
export type DemoChange = {
  type: 'changed' | 'created' | 'deleted'
  path: string
  entry?: FileSystemEntryMetadata
  version?: string
  origin?: string
  writeId?: string
}
export type WriteOptions = { baseVersion?: string; origin?: string; writeId?: string }

export class DemoWorkspace {
  readonly files = new Map<string, DemoFile>()
  readonly directories = new Set([DEMO_ROOT])
  readonly head = new Map<string, string>()
  readonly index = new Map<string, string>()
  readonly revisions = new Map<string, Map<string, string>>()
  readonly project = seedProject()
  readonly worktree = seedWorktree()
  readonly sessions = new Map<string, OrchestrationSession>()
  readonly listeners = new Set<(event: DemoChange) => void>()
  readonly updates = new Set<() => void>()
  readonly history: GitHistoryCommit[] = [
    {
      id: this.worktree.headCommit!,
      parents: [],
      subject: 'Plant a small seasonal garden',
      author: 'Garden demo',
      authorEmail: 'garden@example.invalid',
      timestamp: Date.parse(DEMO_TIME),
    },
  ]
  settings: SettingsSnapshot = seedSettings()
  sequence = 1

  static async create() {
    const workspace = new DemoWorkspace()
    for (const [path, content] of Object.entries(DEMO_FILES))
      await workspace.seedFile(path, content)
    workspace.revisions.set(workspace.history[0]!.id, new Map(workspace.head))
    workspace.sessions.set(seedSession().id, seedSession())
    await workspace.writeFile(
      'notes/autumn.md',
      DEMO_FILES['notes/autumn.md'] + '- Mulch the beds before the first frost.\n',
    )
    return workspace
  }

  path(input: string) {
    const parts = input.startsWith('/') ? input.split('/') : `${DEMO_ROOT}/${input}`.split('/')
    const normalized: string[] = []
    for (const part of parts) {
      if (!part || part === '.') continue
      if (part === '..') {
        normalized.pop()
        continue
      }
      normalized.push(part)
    }
    const result = `/${normalized.join('/')}`
    if (result === DEMO_ROOT || result.startsWith(`${DEMO_ROOT}/`)) return result
    throw demoError('The demo workspace is /garden.', 'NOT_FOUND', 404)
  }

  readFile(input: string) {
    const path = this.path(input)
    const file = this.files.get(path)
    if (!file) return undefined
    return {
      path,
      ...file,
      size: new TextEncoder().encode(file.content).byteLength,
      encoding: 'utf-8' as const,
      lossy: false,
      seemsBinary: false,
    }
  }

  stat(input: string): FileTreeEntry | undefined {
    const path = this.path(input)
    const file = this.files.get(path)
    if (!file && !this.directories.has(path)) return undefined
    return {
      path,
      name: path.split('/').at(-1)!,
      type: file ? 'file' : 'directory',
      canonicalPath: path,
      size: file ? new TextEncoder().encode(file.content).byteLength : 0,
      mtimeMs: file?.mtimeMs ?? Date.parse(DEMO_TIME),
      birthtimeMs: Date.parse(DEMO_TIME),
      version: file?.version ?? 'directory',
    }
  }

  tree(input = DEMO_ROOT, depth = 1) {
    const path = this.path(input || DEMO_ROOT)
    const entries: FileTreeEntry[] = []
    for (const candidate of [...this.directories, ...this.files.keys()].sort()) {
      if (!candidate.startsWith(`${path}/`)) continue
      const remaining = candidate.slice(path.length + 1)
      if (remaining.includes('/')) continue
      const entry = this.stat(candidate)!
      if (entry.type === 'directory' && depth > 1)
        entries.push({ ...entry, children: this.tree(candidate, depth - 1).entries })
      else entries.push(entry)
    }
    return { path, entries }
  }

  async writeFile(input: string, content: string, options: WriteOptions = {}) {
    const path = this.path(input)
    const previous = this.files.get(path)
    if (options.baseVersion && previous?.version !== options.baseVersion)
      throw demoError('The file changed before it was saved.', 'FILE_CONFLICT', 409)
    const version = await contentVersion(content)
    this.createParents(path)
    this.files.set(path, { content, version, mtimeMs: Date.now() })
    const entry = this.stat(path)!
    this.publish({
      type: previous ? 'changed' : 'created',
      path,
      entry,
      version,
      origin: options.origin,
      writeId: options.writeId,
    })
    return entry
  }

  createFolder(input: string) {
    const path = this.path(input)
    this.createParents(`${path}/child`)
    const entry = this.stat(path)!
    this.publish({ type: 'created', path, entry })
    return entry
  }

  deletePath(input: string) {
    const path = this.path(input)
    for (const candidate of [...this.files.keys(), ...this.directories]) {
      if (candidate !== path && !candidate.startsWith(`${path}/`)) continue
      this.files.delete(candidate)
      this.directories.delete(candidate)
    }
    this.publish({ type: 'deleted', path })
    return { path }
  }

  async movePath(from: string, to: string, copy = false) {
    const path = this.path(from)
    const destination = this.path(to)
    const files = [...this.files].filter(
      ([candidate]) => candidate === path || candidate.startsWith(`${path}/`),
    )
    for (const [candidate, file] of files)
      await this.writeFile(destination + candidate.slice(path.length), file.content)
    if (!copy) this.deletePath(path)
    return this.stat(destination) ?? this.createFolder(destination)
  }

  repository(): GitRepositoryInfo {
    return {
      path: DEMO_ROOT,
      branch: this.worktree.branch,
      commit: this.history[0]?.id ?? null,
      ahead: 0,
      behind: 0,
    }
  }

  gitStatus() {
    const files: GitFileStatus[] = []
    const paths = new Set([...this.head.keys(), ...this.index.keys(), ...this.files.keys()])
    for (const path of paths) {
      const head = this.head.get(path)
      const index = this.index.get(path)
      const current = this.files.get(path)?.content
      if (head === index && index === current) continue
      const status = changeKind(head, current)
      files.push({
        path,
        index: changeKind(head, index),
        worktree: changeKind(index, current),
        status: status === 'unmodified' ? 'modified' : status,
      })
    }
    return { repository: this.repository(), files }
  }

  stage(inputs: readonly string[], staged: boolean) {
    const paths = inputs.length
      ? inputs.map((path) => this.path(path))
      : this.gitStatus().files.map((file) => file.path)
    for (const path of paths)
      this.copyVersion(
        staged ? this.files.get(path)?.content : this.head.get(path),
        this.index,
        path,
      )
    this.publish({ type: 'changed', path: DEMO_ROOT })
  }

  async discard(inputs: readonly string[]) {
    for (const input of inputs) {
      const path = this.path(input)
      const content = this.index.get(path)
      if (content === undefined) this.deletePath(path)
      else await this.writeFile(path, content)
    }
  }

  commit(message: string) {
    const changed = [...new Set([...this.head.keys(), ...this.index.keys()])].some(
      (path) => this.head.get(path) !== this.index.get(path),
    )
    if (!changed) throw demoError('Stage a change before committing.', 'NOTHING_TO_COMMIT', 400)
    const id = crypto.randomUUID().replaceAll('-', '').padEnd(40, '0')
    this.history.unshift({
      id,
      parents: [this.history[0]!.id],
      subject: message,
      author: 'You',
      authorEmail: 'you@example.invalid',
      timestamp: Date.now(),
    })
    this.revisions.set(id, new Map(this.index))
    this.head.clear()
    for (const [path, content] of this.index) this.head.set(path, content)
    this.publish({ type: 'changed', path: DEMO_ROOT })
    return {
      kind: 'committed' as const,
      repository: this.repository(),
      output: `[${this.worktree.branch} ${id.slice(0, 7)}] ${message}`,
    }
  }

  diffs(staged: boolean): GitFileDiff[] {
    const before = staged ? this.head : this.index
    const after = staged
      ? this.index
      : new Map([...this.files].map(([path, file]) => [path, file.content]))
    return [...new Set([...before.keys(), ...after.keys()])]
      .filter((path) => before.get(path) !== after.get(path))
      .map((path) => fileDiff(path, before.get(path), after.get(path), staged))
  }

  updated() {
    this.sequence += 1
    for (const update of this.updates) update()
  }

  private publish(change: DemoChange) {
    for (const listener of this.listeners) listener(change)
  }

  private async seedFile(path: string, content: string) {
    const full = this.path(path)
    this.createParents(full)
    this.files.set(full, {
      content,
      version: await contentVersion(content),
      mtimeMs: Date.parse(DEMO_TIME),
    })
    this.head.set(full, content)
    this.index.set(full, content)
  }

  private createParents(path: string) {
    const parts = path.split('/')
    parts.pop()
    while (parts.length > 1) {
      this.directories.add(parts.join('/'))
      parts.pop()
    }
  }

  private copyVersion(content: string | undefined, target: Map<string, string>, path: string) {
    if (content === undefined) target.delete(path)
    else target.set(path, content)
  }
}

export function demoError(message: string, code = 'DEMO_UNAVAILABLE', status = 400) {
  return createError({
    message,
    status,
    code,
    why: 'This workspace runs entirely in browser memory.',
    fix: 'Use the demo files and supported commands, or reset the demo.',
  })
}

async function contentVersion(content: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
  return `sha256:${[...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function changeKind(
  before: string | undefined,
  after: string | undefined,
): 'unmodified' | 'deleted' | 'added' | 'modified' {
  if (before === after) return 'unmodified'
  if (after === undefined) return 'deleted'
  if (before === undefined) return 'added'
  return 'modified'
}
