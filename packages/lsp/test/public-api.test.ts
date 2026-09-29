import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import * as lspApi from '../src/index.ts'
import {
  LspClient,
  LspWorkspace,
  arrayLspLineStarts,
  createWorkerLspTransport,
  defaultClientCapabilities,
  offsetToLspPosition,
  type LspDocumentOpenSnapshotOptions,
  type LspDocumentTransitionOptions,
  type LspTextSnapshot,
  type LspTextEdit,
  type LspTransport,
  type LspWorkspaceDocumentAttachment,
  type LspWorkspaceSnapshotEditOptions,
  type LspWorkspaceUnchangedSourceOptions,
} from '../src/index.ts'

describe('public API facade', () => {
  it('exports the LSP client, workspace, transport types, and helpers', () => {
    const transport: LspTransport = {
      send: () => undefined,
      subscribe: () => undefined,
      unsubscribe: () => undefined,
    }
    const edit: LspTextEdit = { from: 0, to: 0, text: 'x' }

    expect(LspClient).toBeTypeOf('function')
    expect(LspWorkspace).toBeTypeOf('function')
    expect(createWorkerLspTransport).toBeTypeOf('function')
    expect(defaultClientCapabilities().textDocument?.synchronization?.didSave).toBe(false)
    expect(offsetToLspPosition('abc', 1)).toEqual({ line: 0, character: 1 })
    expect(edit).toEqual({ from: 0, to: 0, text: 'x' })
    expect(transport).toBeTruthy()
  })

  it('exports only the snapshot and attachment workspace document surface', () => {
    const workspace = new LspWorkspace()
    const textSnapshot: LspTextSnapshot = {
      length: 3,
      readRange: (start, end) => 'one'.slice(start, end),
      forEachTextChunk: (visit) => visit('one', 0, 3),
    }
    const sourceSegment = {}
    const openOptions: LspDocumentOpenSnapshotOptions = {
      languageId: 'typescript',
      lineStarts: arrayLspLineStarts([0]),
      sourceRevision: 0,
      sourceSegment,
      textSnapshot,
      uri: 'file:///repo/public-api.ts',
    }
    const opened = workspace.openDocumentSnapshot(openOptions)
    const attachment: LspWorkspaceDocumentAttachment = opened.attachment
    const editOptions: LspWorkspaceSnapshotEditOptions = {
      edits: [],
      lineStarts: openOptions.lineStarts,
      logicalRevisionCount: 0,
      sourceRevision: 0,
      sourceSegment,
      textSnapshot,
    }
    const unchangedOptions: LspWorkspaceUnchangedSourceOptions = {
      lineStarts: openOptions.lineStarts,
      sourceRevision: 0,
      sourceSegment,
      textSnapshot,
    }
    const transitionOptions: LspDocumentTransitionOptions = {
      ...openOptions,
      sourceRevision: 0,
      sourceSegment: {},
      sourceTextVersion: 0,
      uri: 'file:///repo/public-api-renamed.ts',
    }

    expect(workspace.updateDocumentSnapshot(openOptions.uri, editOptions).version).toBe(0)
    expect(workspace.adoptUnchangedDocumentSource(openOptions.uri, unchangedOptions).version).toBe(
      0,
    )
    expect(workspace.transitionDocumentUri(attachment, transitionOptions).document.uri).toBe(
      transitionOptions.uri,
    )
    expect(workspace).not.toHaveProperty('openDocument')
    workspace.closeDocument(attachment)
  })

  it('does not export editor plugin factories', () => {
    expect(lspApi).not.toHaveProperty('createLspPlugin')
    expect(Object.keys(lspApi).filter((name) => name.includes('Plugin'))).toEqual([])
  })

  it('stays independent from editor plugin APIs', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      readonly dependencies?: Record<string, string>
      readonly peerDependencies?: Record<string, string>
      readonly devDependencies?: Record<string, string>
    }
    const text = sourceText()

    expect(packageJson.dependencies ?? {}).not.toHaveProperty('@singapore-editor/core')
    expect(packageJson.peerDependencies ?? {}).not.toHaveProperty('@singapore-editor/core')
    expect(packageJson.devDependencies ?? {}).not.toHaveProperty('@singapore-editor/core')
    expect(text).not.toContain('@singapore-editor/core')
    expect(text).not.toContain('EditorPlugin')
  })
})

function sourceText(): string {
  return readdirSync('src')
    .filter((file) => file.endsWith('.ts'))
    .map((file) => readFileSync(join('src', file), 'utf8'))
    .join('\n')
}
