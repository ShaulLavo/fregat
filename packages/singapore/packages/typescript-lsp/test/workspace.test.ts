import { expect, it, vi } from 'vitest'
import type { LspClient } from '@singapore-editor/lsp'
import { TypeScriptLspWorkspace } from '../src/workspace'

function client() {
  return {
    initialized: true,
    initializeResult: { capabilities: {} },
    notify: vi.fn().mockResolvedValue(undefined),
  }
}

it('seeds a shared connection once and retains it until its final borrower leaves', () => {
  const workspace = new TypeScriptLspWorkspace()
  workspace.setWorkspaceFiles([{ path: '/a.ts', text: 'a' }])
  const shared = client()
  const first = workspace.registerClient(shared as unknown as LspClient, undefined)
  const second = workspace.registerClient(shared as unknown as LspClient, undefined)
  workspace.syncClient(shared as unknown as LspClient)
  workspace.syncClient(shared as unknown as LspClient)
  expect(shared.notify).toHaveBeenCalledTimes(1)
  first.dispose()
  workspace.upsertWorkspaceFiles([{ path: '/a.ts', text: 'b' }])
  expect(shared.notify).toHaveBeenLastCalledWith('editor/typescript/upsertFiles', {
    files: [{ path: '/a.ts', text: 'b' }],
  })
  second.dispose()
  shared.notify.mockClear()
  workspace.upsertWorkspaceFiles([{ path: '/a.ts', text: 'c' }])
  expect(shared.notify).not.toHaveBeenCalled()
})

it('re-seeds after reconnect and a full replacement but skips unchanged contents', () => {
  const workspace = new TypeScriptLspWorkspace()
  const shared = client()
  workspace.registerClient(shared as unknown as LspClient, undefined)
  workspace.setWorkspaceFiles([{ path: '/a.ts', text: 'a' }])
  workspace.upsertWorkspaceFiles([{ path: '/a.ts', text: 'a' }])
  expect(shared.notify).toHaveBeenCalledTimes(1)
  shared.initializeResult = { capabilities: {} }
  workspace.syncClient(shared as unknown as LspClient)
  expect(shared.notify).toHaveBeenCalledTimes(2)
  workspace.setWorkspaceFiles([{ path: '/b.ts', text: 'b' }])
  expect(shared.notify).toHaveBeenCalledTimes(3)
})

it('keeps a newly registered client when an old lease is disposed twice', () => {
  const workspace = new TypeScriptLspWorkspace()
  const shared = client()
  const old = workspace.registerClient(shared as unknown as LspClient, undefined)
  old.dispose()
  workspace.registerClient(shared as unknown as LspClient, undefined)
  old.dispose()
  workspace.setWorkspaceFiles([{ path: '/a.ts', text: 'a' }])
  expect(shared.notify).toHaveBeenCalledTimes(1)
})
