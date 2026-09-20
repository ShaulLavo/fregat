import { createTreeError } from '../structured-errors'

import {
  appendChildReference,
  createDirectoryChildIndex,
  createPresortedDirectoryChildIndex,
} from './child-index'
import {
  addNodeFlag,
  createNodeDepthAndFlags,
  getNodeDepth,
  hasNodeFlag,
  isDirectoryNode,
} from './internal-types'
import type {
  DirectoryChildIndex,
  InternalPreparedInput,
  NodeId,
  PathStoreNode,
  PathStoreNodeKind,
  SegmentId,
  PathStoreSnapshot,
  PreparedPath,
  ResolvedPathStoreOptions,
  SegmentSortKey,
} from './internal-types'

interface PathStoreBuilderStartupHints {
  initialExpandedPaths?: readonly string[]
}

type PreparedInputKind = 'prepared' | 'presorted'

const PREPARED_INPUT_KIND = Symbol('pathStorePreparedInputKind')

type ValidatedPreparedInput = InternalPreparedInput & {
  [PREPARED_INPUT_KIND]?: PreparedInputKind
}

function attachPreparedInputKind<TValue extends InternalPreparedInput>(
  value: TValue,
  kind: PreparedInputKind,
): TValue {
  ;(value as ValidatedPreparedInput)[PREPARED_INPUT_KIND] = kind
  return value
}

import { PATH_STORE_NODE_FLAG_EXPLICIT } from './internal-types'
import { PATH_STORE_NODE_FLAG_ROOT } from './internal-types'
import { PATH_STORE_NODE_KIND_DIRECTORY } from './internal-types'
import { resolvePathStoreOptions } from './options'
import { parseInputPath } from './path'
import type {
  PathStoreCompareEntry,
  PathStoreOptions,
  PathStorePathComparator,
} from './public-types'
import { internSegment } from './segments'
import { createSegmentTable } from './segments'
import { comparePreparedPaths, comparePreparedPathsWithCachedSortKeys } from './sort'

function createCompareEntry(preparedPath: PreparedPath): PathStoreCompareEntry {
  return {
    basename: preparedPath.basename,
    depth: preparedPath.segments.length,
    isDirectory: preparedPath.isDirectory,
    path: preparedPath.path,
    segments: preparedPath.segments,
  }
}

function compareWithSortOption(
  left: PreparedPath,
  right: PreparedPath,
  sort: 'default' | PathStorePathComparator,
): number {
  if (sort === 'default') {
    return comparePreparedPaths(left, right)
  }

  return sort(createCompareEntry(left), createCompareEntry(right))
}

function createRootNode(): PathStoreNode {
  return {
    depthAndFlags: createNodeDepthAndFlags(
      0,
      PATH_STORE_NODE_FLAG_EXPLICIT | PATH_STORE_NODE_FLAG_ROOT,
      PATH_STORE_NODE_KIND_DIRECTORY,
    ),
    nameId: 0,
    parentId: 0,
    subtreeNodeCount: 1,
    visibleSubtreeCount: 1,
  }
}

function computeSharedPrefixLength(left: readonly string[], right: readonly string[]): number {
  const maxLength = Math.min(left.length, right.length)
  for (let index = 0; index < maxLength; index++) {
    if (left[index] !== right[index]) {
      return index
    }
  }

  return maxLength
}

function getDirectoryDepth(preparedPath: PreparedPath): number {
  return preparedPath.isDirectory ? preparedPath.segments.length : preparedPath.segments.length - 1
}

function isPreparedPathArray(value: unknown): value is readonly PreparedPath[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        entry != null &&
        typeof entry === 'object' &&
        typeof entry.path === 'string' &&
        Array.isArray(entry.segments) &&
        typeof entry.basename === 'string' &&
        typeof entry.isDirectory === 'boolean',
    )
  )
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

export function preparePaths(paths: readonly string[], options: PathStoreOptions = {}): string[] {
  return preparePathEntries(paths, options).map((entry) => entry.path)
}

export function prepareInput(
  paths: readonly string[],
  options: PathStoreOptions = {},
): InternalPreparedInput {
  const preparedPaths = preparePathEntries(paths, options)
  return attachPreparedInputKind(
    {
      paths: preparedPaths.map((entry) => entry.path),
      preparedPaths,
    },
    'prepared',
  )
}

export function preparePresortedInput(paths: readonly string[]): InternalPreparedInput {
  // Skip the defensive copy: the input is `readonly string[]`, internal
  // consumers (builder.appendPresortedPaths / appendPresortedFilePaths) only
  // iterate it, and we brand the returned prepared input so it cannot be
  // round-tripped through a mutating caller without going back through
  // PathStore.prepareInput. On 929K-path workloads the copy alone costs
  // several milliseconds that page.createOptions cannot afford.
  const pathCount = paths.length
  let presortedPathsContainDirectories = false

  for (let index = 0; index < pathCount; index += 1) {
    const path = paths[index]
    if (path.length > 0 && path.charCodeAt(path.length - 1) === 47) {
      presortedPathsContainDirectories = true
      break
    }
  }

  return attachPreparedInputKind(
    {
      paths,
      presortedPaths: paths,
      presortedPathsContainDirectories,
    },
    'presorted',
  )
}

export function getPreparedInputEntries(
  preparedInput: import('./public-types').PathStorePreparedInput,
): readonly PreparedPath[] {
  const internalPreparedInput = preparedInput as Partial<ValidatedPreparedInput>
  const preparedPaths = internalPreparedInput.preparedPaths
  if (internalPreparedInput[PREPARED_INPUT_KIND] === 'prepared' && preparedPaths != null) {
    return preparedPaths
  }

  if (!isPreparedPathArray(preparedPaths)) {
    throw createTreeError('preparedInput must come from PathStore.prepareInput()')
  }

  return preparedPaths
}

export function getPreparedInputPresortedPaths(
  preparedInput: import('./public-types').PathStorePreparedInput,
): readonly string[] | null {
  const internalPreparedInput = preparedInput as Partial<ValidatedPreparedInput>
  if (
    internalPreparedInput[PREPARED_INPUT_KIND] === 'presorted' &&
    internalPreparedInput.presortedPaths != null
  ) {
    return internalPreparedInput.presortedPaths
  }

  return isStringArray(internalPreparedInput.presortedPaths)
    ? internalPreparedInput.presortedPaths
    : null
}

export function getPreparedInputPresortedPathsContainDirectories(
  preparedInput: import('./public-types').PathStorePreparedInput,
): boolean | null {
  const internalPreparedInput = preparedInput as Partial<InternalPreparedInput>
  return typeof internalPreparedInput.presortedPathsContainDirectories === 'boolean'
    ? internalPreparedInput.presortedPathsContainDirectories
    : null
}

export function preparePathEntries(
  paths: readonly string[],
  options: PathStoreOptions = {},
): PreparedPath[] {
  const resolvedOptions = resolvePathStoreOptions(options)
  const preparedPaths = paths.map((path) => parseInputPath(path))

  preparedPaths.sort((left, right) => compareWithSortOption(left, right, resolvedOptions.sort))

  return preparedPaths
}

interface PresortedCursor {
  depth: number
  segmentStart: number
  cachedPrefix: string
  cachedDepth: number
  previousPath: string | null
}

// Reuse one cursor per batch; shared-prefix scanning must not allocate per path.
function seekSharedDirectoryPrefix(
  cursor: PresortedCursor,
  path: string,
  endIndex: number,
  isDirectory: boolean,
): void {
  cursor.depth = 0
  cursor.segmentStart = 0
  const previousPath = cursor.previousPath
  if (previousPath == null) return
  if (
    cursor.cachedPrefix.length > 0 &&
    path.length > cursor.cachedPrefix.length &&
    path.startsWith(cursor.cachedPrefix)
  ) {
    cursor.depth = cursor.cachedDepth
    cursor.segmentStart = cursor.cachedPrefix.length
    return
  }

  const compareLength = Math.min(endIndex, previousPath.length)
  for (let index = 0; index < compareLength; index++) {
    const character = path.charCodeAt(index)
    if (character !== previousPath.charCodeAt(index)) return
    if (character !== 47) continue
    cursor.depth++
    cursor.segmentStart = index + 1
  }
  if (
    isDirectory &&
    compareLength === endIndex &&
    previousPath.length > endIndex &&
    previousPath.charCodeAt(endIndex) === 47
  ) {
    cursor.depth++
    cursor.segmentStart = endIndex + 1
  }
}

export class PathStoreBuilder {
  private readonly directories = new Map<NodeId, DirectoryChildIndex>()
  private readonly directoryStack: NodeId[] = [0]
  // Tracks directory node IDs in creation order during presorted ingestion,
  // so later callers (initializeOpenVisibleCounts) can walk only directories
  // in post-order (via reverse iteration) without scanning the whole nodes
  // array or allocating via Array.from(directories.keys()).
  private readonly presortedDirectoryNodeIds: NodeId[] = []
  private readonly initialExpandedPathSet: ReadonlySet<string> | null
  private createdDirectoriesAllExpanded = false
  private createdDirectoryCount = 0
  private lastPreparedPath: PreparedPath | null = null
  private readonly nodes: PathStoreNode[] = [createRootNode()]
  private readonly options: ResolvedPathStoreOptions
  private readonly segmentSortKeyCache = new Map<string, SegmentSortKey>()
  private readonly segmentTable = createSegmentTable()
  private hasDeferredDirectoryIndexes = false

  public constructor(options: PathStoreOptions = {}) {
    this.options = resolvePathStoreOptions(options)

    const initialExpandedPaths =
      (options as PathStoreBuilderStartupHints).initialExpandedPaths ?? null
    if (initialExpandedPaths == null || initialExpandedPaths.length === 0) {
      this.initialExpandedPathSet = null
    } else {
      // Normalize trailing slashes so the Set matches what the presorted
      // builder's path.slice(0, slashPos) produces (no trailing slash).
      // charCodeAt + slice is measurably faster than endsWith on hot paths;
      // on linux-10x this loop runs 61K times.
      const normalizedPaths = new Set<string>()
      const hintCount = initialExpandedPaths.length
      for (let index = 0; index < hintCount; index += 1) {
        const path = initialExpandedPaths[index]
        const length = path.length
        normalizedPaths.add(
          length > 0 && path.charCodeAt(length - 1) === 47 ? path.slice(0, length - 1) : path,
        )
      }
      this.initialExpandedPathSet = normalizedPaths
      this.createdDirectoriesAllExpanded = true
    }

    this.directories.set(0, createDirectoryChildIndex())
  }

  public appendPaths(paths: readonly string[]): this {
    return this.appendPreparedPaths(paths.map((path) => parseInputPath(path)))
  }

  public appendPreparedPaths(preparedPaths: readonly PreparedPath[], validateOrder = true): this {
    this.createdDirectoriesAllExpanded = false

    for (const preparedPath of preparedPaths) {
      this.appendPreparedPath(preparedPath, validateOrder)
    }

    return this
  }

  public appendPresortedPaths(
    paths: readonly string[],
    containsDirectories: boolean | null = null,
  ): this {
    const filesOnly = containsDirectories === false
    if (!filesOnly) this.createdDirectoriesAllExpanded = false
    const cursor: PresortedCursor = {
      depth: 0,
      segmentStart: 0,
      cachedPrefix: '',
      cachedDepth: 0,
      previousPath: null,
    }

    for (const path of paths) {
      if (cursor.previousPath === path) {
        throw createTreeError(`Duplicate path: "${path}"`)
      }
      const isDirectory = !filesOnly && path.length > 0 && path.charCodeAt(path.length - 1) === 47
      const endIndex = isDirectory ? path.length - 1 : path.length
      seekSharedDirectoryPrefix(cursor, path, endIndex, isDirectory)
      this.appendPresortedDirectories(cursor, path, endIndex, filesOnly)
      this.appendPresortedTerminal(cursor, path, endIndex, isDirectory)

      if (cursor.segmentStart !== cursor.cachedPrefix.length) {
        cursor.cachedPrefix = path.substring(0, cursor.segmentStart)
        cursor.cachedDepth = cursor.depth
      }
      cursor.previousPath = path
    }

    this.directoryStack.length = cursor.depth + 1
    if (cursor.previousPath != null) this.lastPreparedPath = parseInputPath(cursor.previousPath)
    this.hasDeferredDirectoryIndexes = true
    return this
  }

  private appendPresortedDirectories(
    cursor: PresortedCursor,
    path: string,
    endIndex: number,
    filesOnly: boolean,
  ): void {
    let slash = path.indexOf('/', cursor.segmentStart)
    while (slash >= 0 && slash < endIndex) {
      const nodeId = this.appendPresortedDirectory(cursor, path, slash)
      this.recordCreatedDirectoryPath(path.slice(0, slash))
      if (filesOnly) this.presortedDirectoryNodeIds.push(nodeId)
      slash = path.indexOf('/', cursor.segmentStart)
    }
  }

  private appendPresortedDirectory(cursor: PresortedCursor, path: string, end: number): NodeId {
    const parentId = this.directoryStack[cursor.depth]
    if (parentId === undefined) {
      throw createTreeError('Directory stack underflow while building the path store')
    }
    const nameId = internSegment(this.segmentTable, path.slice(cursor.segmentStart, end))
    cursor.depth++
    const nodeId = this.appendNode(parentId, nameId, cursor.depth, PATH_STORE_NODE_KIND_DIRECTORY)
    this.directoryStack[cursor.depth] = nodeId
    cursor.segmentStart = end + 1
    return nodeId
  }

  private appendPresortedTerminal(
    cursor: PresortedCursor,
    path: string,
    endIndex: number,
    isDirectory: boolean,
  ): void {
    if (isDirectory && cursor.segmentStart < endIndex) {
      this.appendPresortedDirectory(cursor, path, endIndex)
    }
    const parentId = this.directoryStack[cursor.depth]
    if (parentId === undefined) {
      throw createTreeError(
        `Unable to resolve ${isDirectory ? 'directory node' : 'file parent'} for "${path}"`,
      )
    }
    if (isDirectory) {
      this.promoteDirectoryToExplicit(parentId, path)
      return
    }
    const nameId = internSegment(this.segmentTable, path.slice(cursor.segmentStart))
    this.appendNode(parentId, nameId, cursor.depth + 1)
  }

  public finish(): PathStoreSnapshot {
    if (this.hasDeferredDirectoryIndexes) {
      this.buildPresortedFinish()
      this.hasDeferredDirectoryIndexes = false
    }
    return {
      directories: this.directories,
      nodes: this.nodes,
      options: this.options,
      rootId: 0,
      segmentTable: this.segmentTable,
      presortedDirectoryNodeIds:
        this.presortedDirectoryNodeIds.length > 0 ? this.presortedDirectoryNodeIds : null,
    }
  }

  // Reports whether the presorted builder saw every created directory in the
  // caller's startup expansion hint. PathStore uses this to recognize the
  // "all directories start open" case without rescanning the finished
  // snapshot.
  public didMatchAllInitialExpandedPaths(): boolean {
    return (
      this.createdDirectoriesAllExpanded &&
      this.initialExpandedPathSet != null &&
      this.createdDirectoryCount === this.initialExpandedPathSet.size
    )
  }

  private appendPreparedPath(preparedPath: PreparedPath, validateOrder: boolean): void {
    if (this.hasDeferredDirectoryIndexes) {
      this.buildDirectoryIndexes()
      this.hasDeferredDirectoryIndexes = false
    }

    if (this.lastPreparedPath != null) {
      if (preparedPath.path === this.lastPreparedPath.path) {
        throw createTreeError(`Duplicate path: "${preparedPath.path}"`)
      }

      if (validateOrder) {
        const orderComparison =
          this.options.sort === 'default'
            ? comparePreparedPathsWithCachedSortKeys(
                this.lastPreparedPath,
                preparedPath,
                this.segmentSortKeyCache,
              )
            : compareWithSortOption(this.lastPreparedPath, preparedPath, this.options.sort)
        if (orderComparison > 0) {
          throw createTreeError(
            `Builder input must be sorted before appendPaths(): "${preparedPath.path}"`,
          )
        }
      }
    }

    const previousPath = this.lastPreparedPath
    const currentDirectoryDepth = getDirectoryDepth(preparedPath)
    const previousDirectoryDepth = previousPath == null ? 0 : getDirectoryDepth(previousPath)
    const sharedPrefixLength =
      previousPath == null
        ? 0
        : computeSharedPrefixLength(previousPath.segments, preparedPath.segments)
    const sharedDirectoryDepth = Math.min(
      sharedPrefixLength,
      currentDirectoryDepth,
      previousDirectoryDepth,
    )

    this.directoryStack.length = sharedDirectoryDepth + 1

    for (
      let segmentIndex = sharedDirectoryDepth;
      segmentIndex < currentDirectoryDepth;
      segmentIndex++
    ) {
      const parentId = this.directoryStack[this.directoryStack.length - 1]
      if (parentId === undefined) {
        throw createTreeError('Directory stack underflow while building the path store')
      }

      const childId = this.createDirectoryChild(
        parentId,
        preparedPath.segments[segmentIndex],
        validateOrder,
      )
      this.directoryStack.push(childId)
    }

    if (preparedPath.isDirectory) {
      const directoryId = this.directoryStack[this.directoryStack.length - 1]
      if (directoryId === undefined) {
        throw createTreeError(`Unable to resolve directory node for "${preparedPath.path}"`)
      }

      this.promoteDirectoryToExplicit(directoryId, preparedPath.path)
      this.lastPreparedPath = preparedPath
      return
    }

    const parentId = this.directoryStack[this.directoryStack.length - 1]
    if (parentId === undefined) {
      throw createTreeError(`Unable to resolve file parent for "${preparedPath.path}"`)
    }

    this.createFileChild(
      parentId,
      preparedPath.basename,
      validateOrder ? preparedPath.path : undefined,
    )
    this.lastPreparedPath = preparedPath
  }

  // Compares each newly created directory path against the caller's startup
  // expansion hint while the presorted builder is already walking those same
  // prefixes, so constructor fast paths can avoid a second tree-wide scan.
  private recordCreatedDirectoryPath(path: string): void {
    if (!this.createdDirectoriesAllExpanded || this.initialExpandedPathSet == null) {
      return
    }

    this.createdDirectoryCount += 1
    if (!this.initialExpandedPathSet.has(path)) {
      this.createdDirectoriesAllExpanded = false
    }
  }

  private createFileChild(parentId: NodeId, basename: string, path?: string): NodeId {
    const nameId = internSegment(this.segmentTable, basename)
    const parentIndex = this.getDirectoryIndex(parentId)
    if (path !== undefined && parentIndex.childIdByNameId?.has(nameId)) {
      throw createTreeError(`Path collides with an existing entry: "${path}"`)
    }
    return this.createIndexedChild(parentId, nameId, parentIndex)
  }

  private createDirectoryChild(parentId: NodeId, segment: string, validateOrder: boolean): NodeId {
    const nameId = internSegment(this.segmentTable, segment)
    const parentIndex = this.getDirectoryIndex(parentId)
    const existingChildId = validateOrder ? parentIndex.childIdByNameId?.get(nameId) : undefined
    if (existingChildId !== undefined) {
      const existingNode = this.nodes[existingChildId]
      if (existingNode != null && !isDirectoryNode(existingNode)) {
        throw createTreeError(
          `Path collides with an existing file while creating directory "${segment}"`,
        )
      }
      return existingChildId
    }
    const nodeId = this.createIndexedChild(
      parentId,
      nameId,
      parentIndex,
      PATH_STORE_NODE_KIND_DIRECTORY,
    )
    this.directories.set(nodeId, createDirectoryChildIndex())
    return nodeId
  }

  private createIndexedChild(
    parentId: NodeId,
    nameId: SegmentId,
    parentIndex: DirectoryChildIndex,
    kind?: PathStoreNodeKind,
  ): NodeId {
    const parentNode = this.nodes[parentId]
    if (parentNode === undefined) {
      throw createTreeError(`Unknown parent node ID: ${String(parentId)}`)
    }
    const nodeId = this.appendNode(parentId, nameId, getNodeDepth(parentNode) + 1, kind)
    parentIndex.childIdByNameId?.set(nameId, nodeId)
    appendChildReference(parentIndex, nodeId)
    return nodeId
  }

  private appendNode(
    parentId: NodeId,
    nameId: SegmentId,
    depth: number,
    kind?: PathStoreNodeKind,
  ): NodeId {
    const nodeId = this.nodes.length
    this.nodes.push({
      depthAndFlags: createNodeDepthAndFlags(depth, 0, kind),
      nameId,
      parentId,
      subtreeNodeCount: 1,
      visibleSubtreeCount: 1,
    })
    return nodeId
  }

  private promoteDirectoryToExplicit(directoryId: NodeId, path: string): void {
    const directoryNode = this.nodes[directoryId]
    if (directoryNode === undefined) {
      throw createTreeError(`Unknown directory node ID: ${String(directoryId)}`)
    }

    if (!isDirectoryNode(directoryNode)) {
      throw createTreeError(`Path is not a directory: "${path}"`)
    }

    if (hasNodeFlag(directoryNode, PATH_STORE_NODE_FLAG_EXPLICIT)) {
      throw createTreeError(`Duplicate path: "${path}"`)
    }

    addNodeFlag(directoryNode, PATH_STORE_NODE_FLAG_EXPLICIT)
  }

  private getDirectoryIndex(directoryId: NodeId): DirectoryChildIndex {
    const existingIndex = this.directories.get(directoryId)
    if (existingIndex !== undefined) {
      return existingIndex
    }

    throw createTreeError(`Unknown directory child index for node ${String(directoryId)}`)
  }

  // Builds directory-child indexes from the flat node list created by the
  // presorted fast path, then computes subtree counts bottom-up and rebuilds
  // directory child aggregates — all in linear passes instead of recursive
  // tree descent.
  private buildPresortedFinish(): void {
    const nodes = this.nodes
    const directories = this.directories

    // Replace the root's directory index with a presorted-lightweight version
    // so it also skips child-position-map population like all other directories
    // created in this pass.
    directories.set(0, createPresortedDirectoryChildIndex())

    // Forward pass: create directory indexes and register children.  Node IDs
    // are assigned sequentially during presorted construction, so iterating in
    // ID order preserves the canonical sorted child order.  Child-position maps
    // are left null to avoid per-child Map.set overhead; they are rebuilt lazily
    // on the first mutation or sibling lookup.
    //
    // A single-entry parent cache avoids repeated Map.get lookups for
    // consecutive children that share the same parent directory.
    let cachedParentId = -1
    let cachedParentIndex: DirectoryChildIndex | null = null

    for (let nodeId = 1; nodeId < nodes.length; nodeId++) {
      const node = nodes[nodeId]
      if (node == null) {
        continue
      }

      if (isDirectoryNode(node)) {
        const dirIndex = createPresortedDirectoryChildIndex()
        directories.set(nodeId, dirIndex)

        // If the next node shares this directory as its parent, the cache
        // will hit immediately.
        cachedParentId = nodeId
        cachedParentIndex = dirIndex
      }

      let parentIndex: DirectoryChildIndex | null | undefined
      if (node.parentId === cachedParentId) {
        parentIndex = cachedParentIndex
      } else {
        parentIndex = directories.get(node.parentId)
        cachedParentId = node.parentId
        cachedParentIndex = parentIndex ?? null
      }

      if (parentIndex != null) {
        parentIndex.childIds.push(nodeId)
      }
    }
  }

  // Builds directory-child indexes in the same layout as buildPresortedFinish
  // but without fused subtree-count computation (used when flushing deferred
  // indexes before switching to the non-presorted append path).
  private buildDirectoryIndexes(): void {
    const nodes = this.nodes

    for (let nodeId = 1; nodeId < nodes.length; nodeId++) {
      const node = nodes[nodeId]
      if (node == null) {
        continue
      }

      if (isDirectoryNode(node)) {
        this.directories.set(nodeId, createDirectoryChildIndex())
      }

      const parentIndex = this.directories.get(node.parentId)
      if (parentIndex != null) {
        if (parentIndex.childIdByNameId != null) {
          parentIndex.childIdByNameId.set(node.nameId, nodeId)
        }
        appendChildReference(parentIndex, nodeId)
      }
    }
  }
}
