import type {
  DocumentRef,
  FilesystemPath,
  TabContent,
  TabId,
  WorkspaceRoot,
} from '@/lib/documents/utils/types'
import type { CommandMetadata, CommandExecution } from '@workspace/client-core/commands/metadata'
import type { EditorKeymapContext } from '@singapore-editor/core/keymap'
import type { EditorSaveService } from '@/features/editor/state/save-service'
import type { Icon } from '@phosphor-icons/react'
import type { QueryClient } from '@tanstack/react-query'

import type { EditorCommands } from '@/features/editor/state/commands'
import type { EditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import type { Theme } from '@/features/settings/providers/theme-context'
import type { SettingsSubmission } from '@workspace/client-core/settings/intent-store'
import type { ChatModePanels } from '@/features/chat-mode/utils/panels'
import type { RequestCloseTab } from '@/features/editor/hooks/use-dirty-tab-close'
import type { EditorDocumentStoreApi } from '@/features/editor/state/document-state'
import type { EditorDiffViewMode } from '@/features/editor/utils/diff-view-mode'
import type { WorkspaceEditService } from '@/features/editor/state/workspace-edit-service'
import type { WorkbenchPanels } from '@/features/workbench/utils/panels'
import type {
  AsyncCommandStart,
  CommandHandlerContext,
  CommandInvocation,
  ImmediateCommandDisposition,
} from '@/keymap/state/command-bus'
import type { FocusService, FocusTargetToken, ResolvedFocusTarget } from '@/lib/focus/state/service'
import type { WorkspaceUiMode } from '@/lib/ui-mode'

export type WorkspaceCommandSnapshot = {
  readonly activeDocumentSavable: boolean
  readonly activeTabContent: TabContent | null
  readonly activeDocument: DocumentRef | null
  readonly activeTabId: TabId | null
  readonly chatMode: boolean
  readonly chatModePanels: ChatModePanels
  readonly diffViewMode: EditorDiffViewMode
  readonly fileOperationRedoable: boolean
  readonly fileOperationUndoable: boolean
  readonly rootPath: WorkspaceRoot | null
  readonly sessionActionUndoable: boolean
  readonly uiMode: WorkspaceUiMode
  readonly wallpaperEnabled: boolean
  readonly workbenchPanels: WorkbenchPanels
  readonly workspaceOpen: boolean
  readonly workspaceEditRedoable: boolean
  readonly workspaceEditUndoable: boolean
  readonly workspaceMutable: boolean
}

export type WorkspaceCommandRuntime = {
  readonly documents: {
    readonly save: EditorSaveService
    readonly queryClient: QueryClient
    readonly store: EditorDocumentStoreApi
  }
  readonly editor: EditorCommands
  readonly files: {
    readonly openFileAtRef: (path: FilesystemPath, ref: string) => Promise<boolean>
  }
  readonly git: {
    /** Arms or clears the commit that closing COMMIT_EDITMSG completes. */
    readonly setPendingMessageFile: (rootPath: WorkspaceRoot, path: FilesystemPath | null) => void
  }
  readonly focus: FocusService
  readonly settings: {
    readonly nextWallpaper: () => Promise<boolean>
    readonly readSnapshot: () => {
      readonly diffViewMode: EditorDiffViewMode
      readonly wallpaperEnabled: boolean
    }
    readonly setDiffViewMode: (mode: EditorDiffViewMode, initiator?: string) => SettingsSubmission
    readonly setTheme: (theme: Theme, initiator?: string) => SettingsSubmission
    readonly setWallpaperEnabled: (enabled: boolean, initiator?: string) => SettingsSubmission
  }
  readonly shell: {
    readonly openPicker: () => void
    readonly openWorkspaceRoot: (
      rootPath: WorkspaceRoot,
    ) => Promise<'already-open' | 'failed' | 'opened' | 'superseded'>
    readonly showEnvironmentDialog: (mode: 'switch' | 'connect' | 'disconnect') => void
    readonly showMachines: () => void
    readonly showCloneRepository: () => void
    readonly showCommandPalette: (
      initialSearch?: string,
      origin?: FocusTargetToken | null,
    ) => import('@/lib/focus/state/service').FocusTransitionTicket
    readonly showSettings: (
      origin?: FocusTargetToken | null,
      search?: string,
    ) => import('@/lib/focus/state/service').FocusTransitionTicket
  }
  readonly tabs: {
    readonly requestCloseTab: RequestCloseTab
  }
  readonly workspace: EditorWorkspaceStoreApi
  readonly workspaceEdits: Pick<
    WorkspaceEditService,
    | 'applyFileOperation'
    | 'canMutateWorkspace'
    | 'discoverRecovery'
    | 'getSnapshot'
    | 'hasHistoryBarrier'
    | 'redo'
    | 'reverseFileOperation'
    | 'runWorkspaceMutation'
    | 'undo'
  >
}

export type PlatformCommandTarget =
  | {
      readonly keymapContext: EditorKeymapContext | null
      readonly inputElement: HTMLElement | null
      readonly focusTarget: ResolvedFocusTarget
      readonly kind: 'editor'
      readonly logIdentity: string
      readonly token: FocusTargetToken
      readonly writable: boolean
    }
  | {
      readonly kind: 'workspace'
      readonly logIdentity: 'workspace'
    }

export type WorkspaceCommandHandlerContext = CommandHandlerContext<
  WorkspaceCommandRuntime,
  WorkspaceCommandSnapshot,
  PlatformCommandTarget,
  CommandInvocation
>

type CommandBase<Id extends string> = CommandMetadata<Id> & { readonly icon?: Icon }

export type WorkspaceCommand<
  Id extends string = string,
  Execution extends CommandExecution = CommandExecution,
> = Omit<CommandBase<Id>, 'execution'> & {
  readonly execution: Execution
  readonly run: (
    context: WorkspaceCommandHandlerContext,
  ) => Execution extends 'sync' ? ImmediateCommandDisposition : AsyncCommandStart
}

export function defineCommand<
  const Id extends
    | `wallpaper.${string}`
    | `workspace.${string}`
    | `environment.${string}`
    | `fileTree.${string}`,
  const Execution extends CommandExecution,
>(command: WorkspaceCommand<Id, Execution>): WorkspaceCommand<Id, Execution> {
  return command
}
