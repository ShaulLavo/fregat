import * as v from 'valibot'
import type { EditorTabRecord, TabId } from '@/lib/documents/utils/types'

declare const groupIdentity: unique symbol
export type GroupId = string & { readonly [groupIdentity]: 'GroupId' }
export type SplitId = string & { readonly [groupIdentity]: 'SplitId' }
export type GroupAxis = 'horizontal' | 'vertical'
export type GroupEdge = 'left' | 'right' | 'top' | 'bottom'

export type EditorGroup = {
  readonly kind: 'group'
  readonly id: GroupId
  readonly tabs: readonly EditorTabRecord[]
  readonly selectedTabId: TabId | null
}

export type EditorSplit = {
  readonly kind: 'split'
  readonly id: SplitId
  readonly axis: GroupAxis
  readonly children: readonly [SplitChild, SplitChild, ...SplitChild[]]
}

export type GroupNode = EditorGroup | EditorSplit
export type SplitChild = { readonly node: GroupNode; readonly size: number }
export type EditorGroups = { readonly root: GroupNode; readonly activeGroupId: GroupId }

export type TabPlacement = {
  readonly tabId: TabId
  readonly mode: 'move' | 'copy'
  readonly target:
    | { readonly kind: 'group'; readonly groupId: GroupId }
    | {
        readonly kind: 'strip'
        readonly groupId: GroupId
        readonly beforeTabId: TabId | null
      }
    | { readonly kind: 'edge'; readonly groupId: GroupId; readonly edge: GroupEdge }
}

export type PlacementIds = {
  readonly groupId: GroupId
  readonly splitId: SplitId
  readonly tabId: TabId
}

export type TabPlacementResult =
  | {
      readonly status: 'applied'
      readonly groups: EditorGroups
      readonly groupId: GroupId
      readonly tabId: TabId
      readonly removedTabIds: readonly TabId[]
      readonly copiedFromTabId: TabId | null
    }
  | { readonly status: 'unchanged'; readonly groups: EditorGroups }
  | {
      readonly status: 'superseded' | 'rejected'
      readonly groups: EditorGroups
      readonly reason: string
    }

export type GroupResize = {
  readonly splitId: SplitId
  readonly children: readonly { readonly id: GroupId | SplitId; readonly size: number }[]
}

const identitySchema = v.pipe(v.string(), v.minLength(1))

export function groupId(value: string): GroupId {
  return v.parse(identitySchema, value) as GroupId
}

export function splitId(value: string): SplitId {
  return v.parse(identitySchema, value) as SplitId
}

export function createGroupId(): GroupId {
  return groupId(`editor-group:${crypto.randomUUID()}`)
}

export function createSplitId(): SplitId {
  return splitId(`editor-split:${crypto.randomUUID()}`)
}
