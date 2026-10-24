import {
  LspResponseError,
  METHOD_NOT_FOUND,
  semanticTokensClientCapability,
  type LspClient,
} from '@singapore-editor/lsp'
import type * as lsp from 'vscode-languageserver-protocol'

export type ParityDiagnostic = Pick<lsp.Diagnostic, 'range' | 'message' | 'code'>

export type ParitySession = {
  readonly client: Pick<LspClient, 'request' | 'notify'>
  readonly capabilities: lsp.ServerCapabilities | null
  uri(relativePath: string): string
  diagnostics(): Promise<readonly ParityDiagnostic[]>
}

type CapabilityRequirement =
  | { readonly kind: 'always' }
  | { readonly kind: 'all' | 'any'; readonly paths: readonly string[] }

export type ParityCase = {
  readonly id: string
  readonly feature: string
  readonly kind: 'required' | 'variant'
  readonly methods: readonly string[]
  readonly capability: CapabilityRequirement
  readonly expectation: string
  run(session: ParitySession): Promise<unknown>
  useful(result: unknown, session: ParitySession): boolean
}

export type ParityCaseResult = {
  readonly caseId: string
  readonly feature: string
  readonly kind: ParityCase['kind']
  readonly capabilities: readonly { readonly path: string; readonly advertised: boolean }[]
} & (
  | { readonly status: 'supported'; readonly reason: string }
  | { readonly status: 'failed'; readonly reason: string }
  | { readonly status: 'unavailable'; readonly reason: string }
  | { readonly status: 'unrun'; readonly reason: string }
)

export function coreClientCapabilities(): lsp.ClientCapabilities {
  const semanticTokens = semanticTokensClientCapability({ requests: { full: true, range: true } })
  return {
    textDocument: {
      ...semanticTokens.textDocument,
      documentSymbol: { hierarchicalDocumentSymbolSupport: true },
      rename: { prepareSupport: true },
    },
    workspace: { workspaceEdit: { documentChanges: true } },
  }
}

export async function runParityCases(
  session: ParitySession,
  cases: readonly ParityCase[],
): Promise<readonly ParityCaseResult[]> {
  const results: ParityCaseResult[] = []
  for (const row of cases) results.push(await runParityCase(session, row))
  return results
}

export function unrunParityResults(
  cases: readonly ParityCase[],
  reason: string,
): readonly ParityCaseResult[] {
  return cases.map((row) => ({
    caseId: row.id,
    feature: row.feature,
    kind: row.kind,
    capabilities: [],
    status: 'unrun',
    reason,
  }))
}

export function capabilityAdvertised(capabilities: unknown, path: string): boolean {
  let value: unknown = capabilities
  for (const key of path.split('.')) {
    if (!isRecord(value)) return false
    value = value[key]
  }
  return value === true || isRecord(value)
}

const NON_REQUEST_CAPABILITIES = new Set([
  'textDocumentSync',
  'notebookDocumentSync',
  'positionEncoding',
  'experimental',
  'workspace',
])

const NESTED_METHOD_CAPABILITIES = [
  'completionProvider.resolveProvider',
  'codeActionProvider.resolveProvider',
  'renameProvider.prepareProvider',
  'workspaceSymbolProvider.resolveProvider',
  'semanticTokensProvider.full',
  'semanticTokensProvider.range',
  'semanticTokensProvider.full.delta',
  'diagnosticProvider.workspaceDiagnostics',
  'inlayHintProvider.resolveProvider',
  'codeLensProvider.resolveProvider',
  'documentLinkProvider.resolveProvider',
  'workspace.fileOperations.willCreate',
  'workspace.fileOperations.didCreate',
  'workspace.fileOperations.willRename',
  'workspace.fileOperations.didRename',
  'workspace.fileOperations.willDelete',
  'workspace.fileOperations.didDelete',
]

export function uncoveredCapabilityPaths(
  capabilities: lsp.ServerCapabilities | null,
  cases: readonly ParityCase[],
): readonly string[] {
  if (!capabilities) return []
  const paths = cases.flatMap((row) =>
    row.capability.kind === 'always' ? [] : row.capability.paths,
  )
  const covered = new Set(paths)
  const roots = new Set(paths.map((path) => path.split('.')[0]))
  const missing = Object.keys(capabilities).filter(
    (path) =>
      !NON_REQUEST_CAPABILITIES.has(path) &&
      capabilityAdvertised(capabilities, path) &&
      !roots.has(path),
  )
  return missing.concat(
    NESTED_METHOD_CAPABILITIES.filter(
      (path) => capabilityAdvertised(capabilities, path) && !covered.has(path),
    ),
  )
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function runParityCase(session: ParitySession, row: ParityCase): Promise<ParityCaseResult> {
  const capabilities = capabilityObservations(session, row)
  const metadata = { caseId: row.id, feature: row.feature, kind: row.kind, capabilities }
  if (!requirementMet(row.capability, capabilities)) {
    return { ...metadata, status: 'unavailable', reason: 'Required capability is absent' }
  }
  try {
    const result = await row.run(session)
    if (!row.useful(result, session)) {
      return { ...metadata, status: 'failed', reason: row.expectation }
    }
    return { ...metadata, status: 'supported', reason: row.expectation }
  } catch (error) {
    return { ...metadata, status: 'failed', reason: failureReason(error, row) }
  }
}

function capabilityObservations(session: ParitySession, row: ParityCase) {
  if (row.capability.kind === 'always') return []
  return row.capability.paths.map((path) => ({
    path,
    advertised: capabilityAdvertised(session.capabilities, path),
  }))
}

function requirementMet(
  requirement: CapabilityRequirement,
  observations: readonly { readonly advertised: boolean }[],
): boolean {
  if (requirement.kind === 'always') return true
  if (observations.length === 0) return false
  if (requirement.kind === 'any') return observations.some((entry) => entry.advertised)
  return observations.every((entry) => entry.advertised)
}

function failureReason(error: unknown, row: ParityCase): string {
  if (error instanceof LspResponseError && error.code === METHOD_NOT_FOUND) {
    if (row.capability.kind === 'always') return 'Required request returned MethodNotFound'
    return 'Advertised method returned MethodNotFound'
  }
  return error instanceof Error ? error.message : String(error)
}
