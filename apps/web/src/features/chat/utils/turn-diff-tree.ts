import { pathSegments as normalizePathSegments } from '@/features/chat/utils/path-segments'
import type { ChatTurnDiffSummary } from '@workspace/client-core/chat/types'
import { checkpointChangeStatus, type StatusPresentation } from '@/lib/git-status-symbols'

export type ChatTurnDiffFile = ChatTurnDiffSummary['files'][number]

export type ChatTurnDiffStat = {
  additions: number
  deletions: number
}

type ChatTurnDiffTreeDirectoryNode = {
  children: ChatTurnDiffTreeNode[]
  kind: 'directory'
  name: string
  path: string
  stat: ChatTurnDiffStat
}

type ChatTurnDiffTreeFileNode = {
  /** The checkpoint's change kind; `kind` below only discriminates file from directory. */
  change: StatusPresentation
  kind: 'file'
  name: string
  path: string
  stat: ChatTurnDiffStat | null
}

export type ChatTurnDiffTreeNode = ChatTurnDiffTreeDirectoryNode | ChatTurnDiffTreeFileNode

type MutableDirectoryNode = {
  directories: Map<string, MutableDirectoryNode>
  files: ChatTurnDiffTreeFileNode[]
  name: string
  path: string
  stat: ChatTurnDiffStat
}

const SORT_LOCALE_OPTIONS: Intl.CollatorOptions = { numeric: true, sensitivity: 'base' }

export function buildChatTurnDiffTree(files: readonly ChatTurnDiffFile[]) {
  const root: MutableDirectoryNode = {
    directories: new Map(),
    files: [],
    name: '',
    path: '',
    stat: { additions: 0, deletions: 0 },
  }

  for (const file of files) {
    appendFileToTree(root, file)
  }

  return toTreeNodes(root)
}

export function summarizeChatTurnDiffStats(files: readonly ChatTurnDiffFile[]): ChatTurnDiffStat {
  let additions = 0
  let deletions = 0

  for (const file of files) {
    additions += file.additions
    deletions += file.deletions
  }

  return { additions, deletions }
}

export function hasNonZeroChatTurnDiffStat(stat: ChatTurnDiffStat) {
  return stat.additions > 0 || stat.deletions > 0
}

function appendFileToTree(root: MutableDirectoryNode, file: ChatTurnDiffFile) {
  const segments = normalizePathSegments(file.path)
  if (segments.length === 0) return

  const fileName = segments.at(-1)
  if (!fileName) return

  const stat = readStat(file)
  const { ancestors, currentDirectory } = walkDirectories(root, segments.slice(0, -1))
  currentDirectory.files.push({
    change: checkpointChangeStatus(file.kind),
    kind: 'file',
    name: fileName,
    path: segments.join('/'),
    stat,
  })

  if (stat) {
    addStatToAncestors(ancestors, stat)
  }
}

function walkDirectories(root: MutableDirectoryNode, segments: readonly string[]) {
  const ancestors: MutableDirectoryNode[] = [root]
  let currentDirectory = root

  for (const segment of segments) {
    currentDirectory = ensureDirectory(currentDirectory, segment)
    ancestors.push(currentDirectory)
  }

  return { ancestors, currentDirectory }
}

function ensureDirectory(directory: MutableDirectoryNode, segment: string) {
  const existing = directory.directories.get(segment)
  if (existing) return existing

  const created: MutableDirectoryNode = {
    directories: new Map(),
    files: [],
    name: segment,
    path: directory.path ? `${directory.path}/${segment}` : segment,
    stat: { additions: 0, deletions: 0 },
  }
  directory.directories.set(segment, created)

  return created
}

function addStatToAncestors(ancestors: readonly MutableDirectoryNode[], stat: ChatTurnDiffStat) {
  for (const ancestor of ancestors) {
    ancestor.stat.additions += stat.additions
    ancestor.stat.deletions += stat.deletions
  }
}

function toTreeNodes(directory: MutableDirectoryNode): ChatTurnDiffTreeNode[] {
  const subdirectories = Array.from(directory.directories.values())
    .toSorted(compareByName)
    .map(toDirectoryNode)
    .map(compactDirectoryNode)
  const files = directory.files.toSorted(compareByName)

  return [...subdirectories, ...files]
}

function toDirectoryNode(directory: MutableDirectoryNode): ChatTurnDiffTreeDirectoryNode {
  return {
    children: toTreeNodes(directory),
    kind: 'directory',
    name: directory.name,
    path: directory.path,
    stat: {
      additions: directory.stat.additions,
      deletions: directory.stat.deletions,
    },
  }
}

function compactDirectoryNode(node: ChatTurnDiffTreeDirectoryNode): ChatTurnDiffTreeDirectoryNode {
  const children = node.children.map((child) =>
    child.kind === 'directory' ? compactDirectoryNode(child) : child,
  )
  let compactedNode: ChatTurnDiffTreeDirectoryNode = { ...node, children }

  while (hasSingleDirectoryChild(compactedNode)) {
    const onlyChild = compactedNode.children[0] as ChatTurnDiffTreeDirectoryNode
    compactedNode = {
      children: onlyChild.children,
      kind: 'directory',
      name: `${compactedNode.name}/${onlyChild.name}`,
      path: onlyChild.path,
      stat: onlyChild.stat,
    }
  }

  return compactedNode
}

function hasSingleDirectoryChild(node: ChatTurnDiffTreeDirectoryNode) {
  return node.children.length === 1 && node.children[0]?.kind === 'directory'
}

function readStat(file: ChatTurnDiffFile): ChatTurnDiffStat | null {
  if (!Number.isFinite(file.additions)) return null
  if (!Number.isFinite(file.deletions)) return null

  return {
    additions: file.additions,
    deletions: file.deletions,
  }
}

function compareByName(left: { name: string }, right: { name: string }) {
  return left.name.localeCompare(right.name, undefined, SORT_LOCALE_OPTIONS)
}
