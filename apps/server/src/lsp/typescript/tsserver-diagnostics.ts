import { isRecord } from '@workspace/utils/objects'
import * as v from 'valibot'

const TSSERVER_REQUEST = 'typescript.tsserverRequest'
/** Suggestion diagnostics are never errors, so an agent's read skips them. */
const DIAGNOSTIC_COMMANDS = ['syntacticDiagnosticsSync', 'semanticDiagnosticsSync'] as const
const SEVERITY = { error: 1, warning: 2, message: 3, suggestion: 4 } as const

const locationSchema = v.object({ line: v.number(), offset: v.number() })
const responseSchema = v.object({
  success: v.literal(true),
  body: v.array(
    v.object({
      start: locationSchema,
      end: locationSchema,
      text: v.string(),
      code: v.optional(v.number()),
      category: v.picklist(['error', 'warning', 'message', 'suggestion']),
    }),
  ),
})

/**
 * typescript-language-server publishes without a document version and in parts (syntax, then
 * semantics), so no publication can be tied to the text it describes. tsserver answers requests in
 * the order it reads them, so a request sent after a change reads that change.
 */
export function offersTsserverRequests(initializeResult: unknown) {
  if (!isRecord(initializeResult) || !isRecord(initializeResult.capabilities)) return false
  const provider = initializeResult.capabilities.executeCommandProvider
  return isRecord(provider) && Array.isArray(provider.commands)
    ? provider.commands.includes(TSSERVER_REQUEST)
    : false
}

/** `workspace/executeCommand` params for each tsserver request that together cover a file's errors. */
export function tsserverDiagnosticRequests(uri: string) {
  return DIAGNOSTIC_COMMANDS.map((command) => ({
    command: TSSERVER_REQUEST,
    arguments: [command, { file: uri }],
  }))
}

/** LSP diagnostics from the tsserver answers, or null unless every request succeeded. */
export function lspDiagnosticsFromTsserver(results: readonly unknown[]): unknown[] | null {
  const diagnostics: unknown[] = []
  for (const result of results) {
    const parsed = v.safeParse(responseSchema, result)
    if (!parsed.success) return null
    for (const diagnostic of parsed.output.body) {
      diagnostics.push({
        range: { start: lspPosition(diagnostic.start), end: lspPosition(diagnostic.end) },
        severity: SEVERITY[diagnostic.category],
        message: diagnostic.text,
        code: diagnostic.code,
        source: 'typescript',
      })
    }
  }
  return diagnostics
}

function lspPosition(location: v.InferOutput<typeof locationSchema>) {
  return { line: location.line - 1, character: location.offset - 1 }
}
