// Modified for Platform from Pierre. Apache-2.0; see LICENSE-pierre and UPSTREAM.md.
import { createTreeError } from '../structured-errors'

import { appendChildReference, createDirectoryChildIndex } from './child-index'
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

type PreparedInputKind = 'prepared'

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

export function preparePathEntries(
  paths: readonly string[],
  options: PathStoreOptions = {},
): PreparedPath[] {
  const resolvedOptions = resolvePathStoreOptions(options)
  const preparedPaths = paths.map((path) => parseInputPath(path))

  preparedPaths.sort((left, right) => compareWithSortOption(left, right, resolvedOptions.sort))

  return preparedPaths
}

export class PathStoreBuilder {
  private readonly directories = new Map<NodeId, DirectoryChildIndex>()
  private readonly directoryStack: NodeId[] = [0]
  private lastPreparedPath: PreparedPath | null = null
  private readonly nodes: PathStoreNode[] = [createRootNode()]
  private readonly options: ResolvedPathStoreOptions
  private readonly segmentSortKeyCache = new Map<string, SegmentSortKey>()
  private readonly segmentTable = createSegmentTable()

  public constructor(options: PathStoreOptions = {}) {
    this.options = resolvePathStoreOptions(options)

    this.directories.set(0, createDirectoryChildIndex())
  }

  public appendPaths(paths: readonly string[]): this {
    return this.appendPreparedPaths(paths.map((path) => parseInputPath(path)))
  }

  public appendPreparedPaths(preparedPaths: readonly PreparedPath[], validateOrder = true): this {
    for (const preparedPath of preparedPaths) {
      this.appendPreparedPath(preparedPath, validateOrder)
    }

    return this
  }

  public finish(): PathStoreSnapshot {
    return {
      directories: this.directories,
      nodes: this.nodes,
      options: this.options,
      rootId: 0,
      segmentTable: this.segmentTable,
    }
  }

  private appendPreparedPath(preparedPath: PreparedPath, validateOrder: boolean): void {
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

  private createFileChild(parentId: NodeId, basename: string, path?: string): NodeId {
    const nameId = internSegment(this.segmentTable, basename)
    const parentIndex = this.getDirectoryIndex(parentId)
    if (path !== undefined && parentIndex.childIdByNameId.has(nameId)) {
      throw createTreeError(`Path collides with an existing entry: "${path}"`)
    }
    return this.createIndexedChild(parentId, nameId, parentIndex)
  }

  private createDirectoryChild(parentId: NodeId, segment: string, validateOrder: boolean): NodeId {
    const nameId = internSegment(this.segmentTable, segment)
    const parentIndex = this.getDirectoryIndex(parentId)
    const existingChildId = validateOrder ? parentIndex.childIdByNameId.get(nameId) : undefined
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
    parentIndex.childIdByNameId.set(nameId, nodeId)
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
}
