import type { LspClient, LspWorkspace } from '@singapore-editor/lsp'

/** The connection a host is handed as soon as it exists. */
export type LanguageServerConnectionContext = {
  readonly client: LspClient
  readonly workspace: LspWorkspace
}
