import type { LspClient } from '@singapore-editor/lsp'
import type { LanguageServerSourceConnection } from './retainedSource'

type ConnectionEpoch = {
  readonly initialization: Promise<void>
  readonly connection: LanguageServerSourceConnection
}
const epochs = new WeakMap<LspClient, ConnectionEpoch>()

export function languageServerSourceConnection(
  client: LspClient,
): LanguageServerSourceConnection | null {
  const initialization = client.initialization
  if (!initialization || !client.initialized) return null
  const previous = epochs.get(client)
  if (previous?.initialization === initialization) return previous.connection
  const connection: LanguageServerSourceConnection = {
    generation: (previous?.connection.generation ?? 0) + 1,
    ready: initialization,
    isCurrent: () => client.initialization === initialization && client.initialized,
  }
  epochs.set(client, { initialization, connection })
  return connection
}
