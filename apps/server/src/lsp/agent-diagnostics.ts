import { readFile } from 'node:fs/promises'

import { fileUriForPath } from '@workspace/contracts'
import { isRecord } from '@workspace/utils/objects'

import { withinDiagnosticsBudget } from './diagnostics-budget'
import type { LspFileDiagnostics } from './proxy-session'
import {
  bestLspMatchForFeature,
  matchLspServers,
  type LspServerMatch,
  type LspSettings,
} from './registry'

/** One error as an agent reads it: where, what, and the server's code. */
export type AgentDiagnostic = {
  /** One-based, as editors and agents count lines. */
  readonly line: number
  readonly message: string
  readonly code: string | null
}

type AgentFileErrors = {
  readonly text: string
  readonly mode: LspFileDiagnostics['mode']
  readonly errors: readonly AgentDiagnostic[]
}

/** What an agent session asks after it edits a file; the Claude hooks and Codex route share it. */
export type AgentDiagnosticsSource = {
  readonly enabled: () => boolean
  errors(
    filePath: string,
    workspaceRoot: string,
    timeoutMs: number,
  ): Promise<AgentFileErrors | null>
}

type DiagnosticsPool = {
  fileDiagnostics(
    match: LspServerMatch,
    uri: string,
    timeoutMs: number,
    text: string,
  ): Promise<LspFileDiagnostics | null>
}

const ERROR_SEVERITY = 1

/** Reads a file's errors from the language server already serving it; spawns none. */
export class AgentDiagnosticsReader implements AgentDiagnosticsSource {
  readonly enabled: () => boolean
  private readonly pool: () => DiagnosticsPool
  private readonly settings: () => LspSettings

  constructor(input: {
    enabled: () => boolean
    pool: () => DiagnosticsPool
    settings: () => LspSettings
  }) {
    this.enabled = input.enabled
    this.pool = input.pool
    this.settings = input.settings
  }

  errors(filePath: string, workspaceRoot: string, timeoutMs: number) {
    return withinDiagnosticsBudget(timeoutMs, async (remaining) => {
      const [text, matches] = await Promise.all([
        readFile(filePath, 'utf8'),
        matchLspServers({ filePath, settings: this.settings(), workspaceRoot }),
      ])
      const match = bestLspMatchForFeature(matches, 'diagnostics') ?? matches[0]
      if (!match || remaining() <= 0) return null
      const result = await this.pool().fileDiagnostics(
        match,
        fileUriForPath(filePath),
        remaining(),
        text,
      )
      if (!result) return null
      return { text, mode: result.mode, errors: result.diagnostics.flatMap(agentError) }
    })
  }
}

function agentError(diagnostic: unknown): AgentDiagnostic[] {
  if (!isRecord(diagnostic) || diagnostic.severity !== ERROR_SEVERITY) return []
  if (typeof diagnostic.message !== 'string') return []
  const range = isRecord(diagnostic.range) ? diagnostic.range : null
  const start = range && isRecord(range.start) ? range.start : null
  const line = typeof start?.line === 'number' ? start.line + 1 : 1
  const code =
    typeof diagnostic.code === 'string' || typeof diagnostic.code === 'number'
      ? String(diagnostic.code)
      : null
  return [{ line, message: diagnostic.message, code }]
}
