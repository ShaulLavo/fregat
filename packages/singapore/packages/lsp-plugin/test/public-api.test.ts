import { describe, expect, it } from 'vitest'

import * as lspPlugin from '@singapore-editor/lsp-plugin'
import {
  LanguageServerDocumentSyncController,
  type LanguageServerDocumentSyncControllerRegistration,
  type LanguageServerDocumentUriTransition,
} from '@singapore-editor/lsp-plugin/document-sync-controller'
import {
  parseWorkspaceEdit,
  prepareWorkspaceTextReplay,
  type ParsedWorkspaceEdit,
  type PrepareWorkspaceTextReplayResult,
  type WorkspaceEditFailure,
  type WorkspaceEditOperation,
  type WorkspaceTextDocumentProvenance,
  type WorkspaceTextReplayInput,
} from '@singapore-editor/lsp-plugin/workspace-edit'
import type {
  ApplyWorkspaceEditRequest,
  ApplyWorkspaceEditResult,
  LanguageServerLaneHostOptions,
  LanguageServerDocumentSyncOptions,
  LanguageServerRenamePrompt,
  OnApplyWorkspaceEdit,
  WorkspaceEditOriginGuard,
} from '@singapore-editor/lsp-plugin'

describe('WorkspaceEdit public API', () => {
  it('exports parser and replay contracts from root and workspace-edit', () => {
    type PublicTypes = [
      ParsedWorkspaceEdit,
      PrepareWorkspaceTextReplayResult,
      WorkspaceEditFailure,
      WorkspaceEditOperation,
      WorkspaceTextDocumentProvenance,
      WorkspaceTextReplayInput,
    ]
    const types = null as unknown as PublicTypes

    expect(types).toBeNull()
    expect(lspPlugin.parseWorkspaceEdit).toBe(parseWorkspaceEdit)
    expect(lspPlugin.prepareWorkspaceTextReplay).toBe(prepareWorkspaceTextReplay)
  })

  it('exports synchronous document URI transition contracts from root and subpath', () => {
    type DocumentSyncTypes = [
      LanguageServerDocumentSyncControllerRegistration,
      LanguageServerDocumentSyncOptions,
      LanguageServerDocumentUriTransition,
    ]
    const types = null as unknown as DocumentSyncTypes

    expect(types).toBeNull()
    expect(lspPlugin.LanguageServerDocumentSyncController).toBe(
      LanguageServerDocumentSyncController,
    )
  })

  it('exports the exact host request and settlement vocabulary', () => {
    type HostTypes = [
      ApplyWorkspaceEditRequest,
      ApplyWorkspaceEditResult,
      LanguageServerLaneHostOptions,
      LanguageServerRenamePrompt,
      OnApplyWorkspaceEdit,
      WorkspaceEditOriginGuard,
    ]
    const types = null as unknown as HostTypes

    expect(types).toBeNull()
  })
})
