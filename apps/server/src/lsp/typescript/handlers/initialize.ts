import { isRecord } from '@workspace/utils/objects'
import ts from 'typescript-language-service'
import type * as lsp from 'vscode-languageserver-protocol'

import type {
  SessionContext,
  SessionInitializationOptions,
  WorkspaceEditClientCapabilities,
} from '../shared/context'

const TEXT_DOCUMENT_SYNC_INCREMENTAL = 2

export function handleInitialize(ctx: SessionContext, params: unknown): lsp.InitializeResult {
  const options = initializationOptions(params)
  ctx.applyInitializationOptions(options)
  ctx.invalidateForProjectConfigChange()

  return {
    capabilities: {
      textDocumentSync: {
        openClose: true,
        change: TEXT_DOCUMENT_SYNC_INCREMENTAL,
      },
      diagnosticProvider: {
        interFileDependencies: true,
        workspaceDiagnostics: false,
      },
      hoverProvider: true,
      definitionProvider: true,
      completionProvider: {
        triggerCharacters: ['.', '"', "'", '`', '/', '@', '<'],
        resolveProvider: false,
      },
      signatureHelpProvider: {
        triggerCharacters: ['(', ',', '<'],
        retriggerCharacters: [')'],
      },
      referencesProvider: true,
      documentSymbolProvider: true,
      renameProvider: {
        prepareProvider: true,
      },
      codeActionProvider: true,
    },
    serverInfo: {
      name: 'platform-typescript-lsp',
      version: ts.version,
    },
  }
}

function initializationOptions(params: unknown): SessionInitializationOptions {
  const options = initializationOptionsRecord(params)
  return {
    compilerOptions: isRecord(options?.compilerOptions)
      ? (options.compilerOptions as ts.CompilerOptions)
      : undefined,
    diagnosticDelayMs:
      typeof options?.diagnosticDelayMs === 'number' ? options.diagnosticDelayMs : undefined,
    workspaceEditCapabilities: workspaceEditCapabilities(params),
  }
}

function initializationOptionsRecord(params: unknown): Record<string, unknown> | null {
  if (!isRecord(params)) return null
  return isRecord(params.initializationOptions) ? params.initializationOptions : null
}

function workspaceEditCapabilities(params: unknown): WorkspaceEditClientCapabilities {
  const workspaceEdit = workspaceEditCapabilityRecord(params)
  if (!workspaceEdit) return noWorkspaceEditCapabilities()

  return {
    changeAnnotationSupport: isRecord(workspaceEdit.changeAnnotationSupport),
    documentChanges: workspaceEdit.documentChanges === true,
    resourceOperations: resourceOperations(workspaceEdit.resourceOperations),
  }
}

function workspaceEditCapabilityRecord(params: unknown): Record<string, unknown> | null {
  if (!isRecord(params)) return null
  if (!isRecord(params.capabilities)) return null
  if (!isRecord(params.capabilities.workspace)) return null
  const workspace = params.capabilities.workspace
  return isRecord(workspace.workspaceEdit) ? workspace.workspaceEdit : null
}

function resourceOperations(value: unknown): readonly lsp.ResourceOperationKind[] {
  if (!Array.isArray(value)) return []
  return value.filter(isResourceOperationKind)
}

function isResourceOperationKind(value: unknown): value is lsp.ResourceOperationKind {
  return value === 'create' || value === 'rename' || value === 'delete'
}

function noWorkspaceEditCapabilities(): WorkspaceEditClientCapabilities {
  return {
    changeAnnotationSupport: false,
    documentChanges: false,
    resourceOperations: [],
  }
}
