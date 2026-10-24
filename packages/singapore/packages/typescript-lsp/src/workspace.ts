import type { EditorDisposable } from '@singapore-editor/core/extensions'
import type { LspClient } from '@singapore-editor/lsp'
import {
  SET_WORKSPACE_FILES,
  UPSERT_WORKSPACE_FILES,
  DELETE_WORKSPACE_FILES,
} from './worker/customMethods'

export type TypeScriptLspSourceFile = { readonly path: string; readonly text: string }
type Lease = { readonly onError?: (error: unknown) => void }
type ClientState = {
  readonly leases: Set<Lease>
  initialization: LspClient['initializeResult']
  revision: number
}

/** One source-file set shared by document plugins borrowing the same worker connection. */
export class TypeScriptLspWorkspace {
  private readonly clients = new Map<LspClient, ClientState>()
  private readonly files = new Map<string, string>()
  private revision = 0

  public setWorkspaceFiles(files: readonly TypeScriptLspSourceFile[]): void {
    this.files.clear()
    for (const file of files) this.files.set(file.path, file.text)
    this.revision++
    for (const client of this.clients.keys()) this.syncClient(client)
  }

  public upsertWorkspaceFiles(files: readonly TypeScriptLspSourceFile[]): void {
    const changed = files.filter((file) => this.files.get(file.path) !== file.text)
    if (changed.length === 0) return
    for (const file of changed) this.files.set(file.path, file.text)
    this.revision++
    this.notifyClients(UPSERT_WORKSPACE_FILES, {
      files: changed.map(({ path, text }) => ({ path, text })),
    })
  }

  public deleteWorkspaceFiles(paths: readonly string[]): void {
    const removed = paths.filter((path) => this.files.delete(path))
    if (removed.length === 0) return
    this.revision++
    this.notifyClients(DELETE_WORKSPACE_FILES, { paths: removed })
  }

  public registerClient(
    client: LspClient,
    onError: ((error: unknown) => void) | undefined,
  ): EditorDisposable {
    const state = this.clients.get(client) ?? {
      leases: new Set<Lease>(),
      initialization: null,
      revision: -1,
    }
    this.clients.set(client, state)
    const lease = { onError }
    state.leases.add(lease)
    return {
      dispose: () => {
        if (!state.leases.delete(lease)) return
        if (state.leases.size === 0) this.clients.delete(client)
      },
    }
  }

  public syncClient(client: LspClient): void {
    const state = this.clients.get(client)
    if (!state || !client.initialized) return
    if (state.initialization === client.initializeResult && state.revision === this.revision) return
    this.notify(client, state, SET_WORKSPACE_FILES, {
      files: Array.from(this.files, ([path, text]) => ({ path, text })),
    })
  }

  private notifyClients(method: string, params: unknown): void {
    for (const [client, state] of this.clients) {
      if (!client.initialized) continue
      if (state.initialization !== client.initializeResult) {
        this.syncClient(client)
        continue
      }
      this.notify(client, state, method, params)
    }
  }

  private notify(client: LspClient, state: ClientState, method: string, params: unknown): void {
    state.initialization = client.initializeResult
    state.revision = this.revision
    void client.notify(method, params).catch((error) => {
      for (const lease of state.leases) lease.onError?.(error)
    })
  }
}
