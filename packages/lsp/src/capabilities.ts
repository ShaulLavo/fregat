import type * as lsp from 'vscode-languageserver-protocol'
import type { LspDocumentSaveSync, LspDocumentSyncMode, LspDocumentSyncOptions } from './types'

const TEXT_DOCUMENT_SYNC_NONE = 0
const TEXT_DOCUMENT_SYNC_FULL = 1
const TEXT_DOCUMENT_SYNC_INCREMENTAL = 2

const DIAGNOSTIC_TAG_UNNECESSARY = 1
const DIAGNOSTIC_TAG_DEPRECATED = 2

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The roots of the code-action kind hierarchy, which is what the value set names — a server is free
 * to answer with any kind beneath one of these, and the client matches by dotted prefix.
 */
const CODE_ACTION_KINDS: lsp.CodeActionKind[] = [
  '',
  'quickfix',
  'refactor',
  'refactor.extract',
  'refactor.inline',
  'refactor.rewrite',
  'source',
  'source.organizeImports',
  'source.fixAll',
]

/**
 * What every client of this package declares, before a host adds anything of its own.
 *
 * There is deliberately **no `textDocument.semanticTokens` block here**, and adding one would be a
 * mistake rather than a convenience. The content of that block is the host's — a real server
 * computes its advertised legend as the intersection of its own token types with the ones the
 * client declared, which makes the declared block an input to the server rather than a local table
 * — and declaring it at all commits every server the client speaks to to computing tokens. A host
 * that paints no semantic colour would be paying for answers nobody draws. Hosts that do want them
 * build a block with `semanticTokensClientCapability()` and pass it in as `capabilities`.
 */
export const defaultClientCapabilities = (): lsp.ClientCapabilities => ({
  general: {
    positionEncodings: ['utf-16'],
  },
  workspace: {
    diagnostics: { refreshSupport: true },
  },
  textDocument: {
    synchronization: {
      didSave: false,
      willSave: false,
      willSaveWaitUntil: false,
    },
    // Required, not decorative: typescript-language-server sets
    // `features.diagnosticsSupport = Boolean(publishDiagnostics)` and returns early from every
    // publish without it, so an undeclaring client gets a server that never diagnoses anything.
    publishDiagnostics: {
      tagSupport: { valueSet: [DIAGNOSTIC_TAG_UNNECESSARY, DIAGNOSTIC_TAG_DEPRECATED] },
      versionSupport: true,
    },
    // Pull diagnostics negotiate tags separately; TypeScript 7 sends none without this.
    diagnostic: {
      dynamicRegistration: false,
      relatedDocumentSupport: false,
      tagSupport: { valueSet: [DIAGNOSTIC_TAG_UNNECESSARY, DIAGNOSTIC_TAG_DEPRECATED] },
    },
    hover: {
      contentFormat: ['markdown', 'plaintext'],
    },
    definition: {
      linkSupport: true,
    },
    completion: {
      contextSupport: true,
      completionItem: {
        // The characters an item may be accepted on are withheld from a client that has not said it
        // will act on them, and a set nobody reads is a set no server sends.
        commitCharactersSupport: true,
        documentationFormat: ['markdown', 'plaintext'],
        // An item that can both insert at the caret and overtype the word around it only carries
        // both ranges for a client that says it can choose between them; undeclared, the server
        // picks one for us and picks it before the user has decided how to accept.
        insertReplaceSupport: true,
        labelDetailsSupport: true,
        // Servers defer the expensive parts of an item until resolve; without this they either
        // send nothing there or refuse the request. additionalTextEdits is the load-bearing one —
        // it carries the auto-import.
        resolveSupport: {
          properties: ['documentation', 'detail', 'additionalTextEdits'],
        },
        snippetSupport: true,
      },
    },
    // Without the literal form a server may only answer with bare commands, which carry no kind and
    // no preference — nothing to filter or rank an action by. dataSupport is what lets a server hand
    // back a handle instead of an edit and compute the expensive part only when the fix is chosen.
    codeAction: {
      codeActionLiteralSupport: {
        codeActionKind: { valueSet: CODE_ACTION_KINDS },
      },
      dataSupport: true,
      isPreferredSupport: true,
      resolveSupport: { properties: ['edit'] },
    },
    // Servers only answer what the client advertises, so this has to be declared for
    // textDocument/signatureHelp to come back at all.
    signatureHelp: {
      contextSupport: true,
      signatureInformation: {
        documentationFormat: ['markdown', 'plaintext'],
        parameterInformation: {
          labelOffsetSupport: true,
        },
      },
    },
  },
  window: {
    showMessage: {},
  },
})

export const mergeClientCapabilities = (
  base: lsp.ClientCapabilities,
  override: lsp.ClientCapabilities | undefined,
): lsp.ClientCapabilities => mergeObjects(base, override) as lsp.ClientCapabilities

const WORKSPACE_EDIT_CAPABILITY: NonNullable<
  NonNullable<lsp.ClientCapabilities['workspace']>['workspaceEdit']
> = {
  documentChanges: true,
  resourceOperations: ['create', 'rename', 'delete'],
  failureHandling: 'undo',
  normalizesLineEndings: true,
  changeAnnotationSupport: { groupsOnLabel: true },
}

/**
 * Adds the response capability only when a host can apply the complete plan. The returned block is
 * also the policy boundary: callers cannot smuggle in server-initiated or snippet application.
 */
export const composeWorkspaceEditClientCapabilities = (
  capabilities: lsp.ClientCapabilities | undefined,
  supported: boolean,
): lsp.ClientCapabilities | undefined => {
  const cloned = capabilities
    ? (mergeObjects({}, capabilities) as lsp.ClientCapabilities)
    : undefined
  const workspace = cloned?.workspace
  const {
    applyEdit: _applyEdit,
    workspaceEdit: _workspaceEdit,
    ...preservedWorkspace
  } = workspace ?? {}
  const { workspace: _workspace, ...preservedCapabilities } = cloned ?? {}

  if (supported) {
    return {
      ...preservedCapabilities,
      workspace: { ...preservedWorkspace, workspaceEdit: WORKSPACE_EDIT_CAPABILITY },
    }
  }
  if (Object.keys(preservedWorkspace).length > 0) {
    return { ...preservedCapabilities, workspace: preservedWorkspace }
  }
  if (Object.keys(preservedCapabilities).length > 0) return preservedCapabilities
  return undefined
}

export const documentSyncModeFromCapabilities = (
  capabilities: lsp.ServerCapabilities | null,
): LspDocumentSyncMode => {
  return documentSyncOptionsFromCapabilities(capabilities).change
}

export const documentSyncOptionsFromCapabilities = (
  capabilities: lsp.ServerCapabilities | null,
): LspDocumentSyncOptions => {
  const sync = capabilities?.textDocumentSync
  if (!sync) return noDocumentSync()
  if (typeof sync === 'number') return numericDocumentSync(sync)

  return {
    change: syncModeFromKind(sync.change ?? TEXT_DOCUMENT_SYNC_NONE),
    openClose: sync.openClose === true,
    save: saveSyncFromOptions(sync.save),
  }
}

export const clientSupportsDidSave = (capabilities: lsp.ClientCapabilities): boolean =>
  capabilities.textDocument?.synchronization?.didSave === true

const noDocumentSync = (): LspDocumentSyncOptions => ({
  change: 'none',
  openClose: false,
  save: { enabled: false, includeText: false },
})

const numericDocumentSync = (kind: number): LspDocumentSyncOptions => {
  const change = syncModeFromKind(kind)
  return {
    change,
    openClose: change !== 'none',
    save: { enabled: false, includeText: false },
  }
}

const saveSyncFromOptions = (save: boolean | lsp.SaveOptions | undefined): LspDocumentSaveSync => {
  if (!save) return { enabled: false, includeText: false }
  if (save === true) return { enabled: true, includeText: false }
  return { enabled: true, includeText: save.includeText === true }
}

const syncModeFromKind = (kind: number): LspDocumentSyncMode => {
  if (kind === TEXT_DOCUMENT_SYNC_INCREMENTAL) return 'incremental'
  if (kind === TEXT_DOCUMENT_SYNC_FULL) return 'full'
  return 'none'
}

const mergeObjects = (base: unknown, override: unknown): unknown => {
  if (override === undefined) return cloneValue(base)
  if (!isRecord(base) || !isRecord(override)) return cloneValue(override)

  const result: Record<string, unknown> = {}
  for (const key of Object.keys(base)) {
    result[key] = mergeObjects(base[key], override[key])
  }
  for (const key of Object.keys(override)) {
    if (key in result) continue
    result[key] = cloneValue(override[key])
  }

  return result
}

const cloneValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(cloneValue)
  if (!isRecord(value)) return value

  const result: Record<string, unknown> = {}
  for (const key of Object.keys(value)) result[key] = cloneValue(value[key])
  return result
}
