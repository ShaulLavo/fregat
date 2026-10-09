import { expect, test } from 'vitest'

import * as treePackage from '@workspace/tree'
import type {
  FileTreeBatchOperation,
  FileTreeContextMenuItem,
  FileTreeDirectoryHandle,
  FileTreeDropContext,
  FileTreeDropResult,
  FileTreeDropTarget,
  FileTreeFileHandle,
  FileTreeGitStatusPatch,
  FileTreeItemHandle,
  FileTreeMoveOptions,
  FileTreeMutationEvent,
  FileTreeMutationEventForType,
  FileTreeMutationEventType,
  FileTreeMutationHandle,
  FileTreeMutationSemanticEvent,
  FileTreeOptions,
  FileTreePreparedInput,
  FileTreeRemoveOptions,
  FileTreeRenameEvent,
  FileTreeResetOptions,
  FileTreeRowDecoration,
  FileTreeRowDecorationContext,
  FileTreeRowDecorationRenderer,
  FileTreeScrollToPathOptions,
  FileTreeSearchBlurBehavior,
  FileTreeSearchSessionHandle,
  FileTreeSelectionChangeListener,
  GitStatus,
  GitStatusEntry,
} from '@workspace/tree'

type PublicTypeAllowlist = readonly [
  FileTreeOptions,
  FileTreePreparedInput,
  FileTreeDirectoryHandle,
  FileTreeFileHandle,
  FileTreeItemHandle,
  FileTreeDropTarget,
  FileTreeDropContext,
  FileTreeDropResult,
  FileTreeRenameEvent,
  FileTreeRowDecorationContext,
  FileTreeContextMenuItem,
  FileTreeBatchOperation,
  FileTreeGitStatusPatch,
  FileTreeMoveOptions,
  FileTreeMutationEvent,
  FileTreeMutationEventForType<'*'>,
  FileTreeMutationSemanticEvent,
  FileTreeMutationEventType,
  FileTreeMutationHandle,
  FileTreeRemoveOptions,
  FileTreeResetOptions,
  FileTreeRowDecoration,
  FileTreeRowDecorationRenderer,
  FileTreeScrollToPathOptions,
  FileTreeSearchBlurBehavior,
  FileTreeSearchSessionHandle,
  FileTreeSelectionChangeListener,
  GitStatus,
  GitStatusEntry,
]

type PublicTypesAreNameable = PublicTypeAllowlist extends readonly unknown[] ? true : false

const publicTypesAreNameable: PublicTypesAreNameable = true

test('exports the model and the helpers the app view renders with', () => {
  expect(Object.keys(treePackage).sort()).toEqual([
    'FileTreeController',
    'GIT_STATUS_DESCENDANT_TITLE',
    'GIT_STATUS_LABEL',
    'GIT_STATUS_TITLE',
    'applyFileTreeGitStatusPatch',
    'arePathSetsEqual',
    'computeFileTreeLayout',
    'computeStickyRows',
    'prepareFileTreeInput',
    'resolveFileTreeGitStatusState',
  ])
  expect(publicTypesAreNameable).toBe(true)
})
