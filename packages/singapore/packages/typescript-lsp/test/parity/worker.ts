import { createWorkerLspTransport, LspClient, type LspWorkerLike } from '@singapore-editor/lsp'
import { coreClientCapabilities, type ParitySession } from './contract'
import { CORE_PROJECT, openAndEditCoreProject } from './cases/project'
import { diagnosticsFromReport } from './validators'

export function createWorkerParityFixture({
  worker,
  rootUri = 'file:///',
}: {
  readonly worker: LspWorkerLike
  readonly rootUri?: string
}) {
  const root = rootUri.endsWith('/') ? rootUri : `${rootUri}/`
  const client = new LspClient({
    rootUri: root,
    timeoutMs: 20_000,
    initializationOptions: { diagnosticDelayMs: 0 },
    capabilities: coreClientCapabilities(),
  })
  const session: ParitySession = {
    client,
    get capabilities() {
      return client.serverCapabilities
    },
    uri: (path) => new URL(path, root).href,
    diagnostics: async () =>
      diagnosticsFromReport(
        await client.request('textDocument/diagnostic', {
          textDocument: { uri: session.uri(CORE_PROJECT.mainPath) },
        }),
      ),
  }
  return {
    client,
    session,
    async initialize(): Promise<void> {
      await client.connect(createWorkerLspTransport(worker))
      await client.notify('editor/typescript/setWorkspaceFiles', {
        files: CORE_PROJECT.files.map((file) => ({
          path: decodeURIComponent(new URL(file.path, root).pathname),
          text: file.text,
        })),
      })
      await openAndEditCoreProject(session)
    },
    dispose(): void {
      client.disconnect()
      worker.terminate?.()
    },
  }
}
