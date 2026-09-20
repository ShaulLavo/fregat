import {
  groupId,
  splitId,
  type EditorGroup,
  type EditorGroups,
  type EditorSplit,
  type GroupAxis,
  type GroupNode,
  type PlacementIds,
  type SplitChild,
} from '@/lib/documents/utils/group-types'
import { tabId } from '@/lib/documents/utils/identity'
import type { EditorTabRecord, TabId } from '@/lib/documents/utils/types'
import { testTabContent } from './document-targets'

export function groupTab(id: string, path = `/repo/${id}.ts`): EditorTabRecord {
  return { id: tabId(id), content: testTabContent(path) }
}

export function groupLeaf(
  id: string,
  tabs: readonly EditorTabRecord[],
  selectedTabId: TabId | null = tabs.at(-1)?.id ?? null,
): EditorGroup {
  return { kind: 'group', id: groupId(id), tabs, selectedTabId }
}

export function groupBranch(
  id: string,
  axis: GroupAxis,
  children: readonly [SplitChild, SplitChild, ...SplitChild[]],
): EditorSplit {
  return { kind: 'split', id: splitId(id), axis, children }
}

export function groupTree(root: GroupNode, active: string): EditorGroups {
  return { root, activeGroupId: groupId(active) }
}

export function groupPlacementIds(suffix: string): PlacementIds {
  return {
    groupId: groupId(`group-${suffix}`),
    splitId: splitId(`split-${suffix}`),
    tabId: tabId(`tab-${suffix}`),
  }
}
