type FixtureInput =
  | { type: 'text'; text: string; text_elements?: unknown[] }
  | { type: 'image'; url: string }
  | { type: 'localImage'; path: string }
export type McpTable = {
  url?: string
  command?: string
  args?: string[]
  http_headers?: Record<string, string>
}
export type FixtureParams = {
  input: FixtureInput[]
  threadId: string
  beforeTurnId: string
  lastTurnId: string
  name: string
  cwds: string[]
  edits: { keyPath: string; value: McpTable | null }[]
  cwd?: string
  model?: string
  approvalPolicy?: string
  sortDirection?: string
  limit?: number
  config?: Record<string, unknown>
  includeLayers?: boolean
  outputSchema?: unknown
  collaborationMode?: { mode: string }
}
export type FixtureRequest = {
  id: string | number
  method?: string
  params: FixtureParams
  result?: {
    decision?: string | { acceptWithExecpolicyAmendment: { execpolicy_amendment: string[] } }
  }
}
export type CheckpointEdit =
  | { op: 'write'; path: string; text: string }
  | { op: 'delete'; path: string }
  | { op: 'git'; args: string[] }
  | { op: 'rename'; path: string; to: string }
export type CheckpointControl = {
  cwd: string
  turns: CheckpointEdit[][]
  hold?: boolean
  revertDelayMs?: number
}
export type TitleControl = {
  mode: string
  title: string
  usage?: boolean
  holdConversation?: boolean
}
