import { describe, expect, it } from 'vitest'
import { documentUriForFileName, fileNameForUri } from '../shared/boundary'

describe.runIf(process.platform !== 'win32')('native TypeScript workspace URIs', () => {
  it.each(['normal.ts', 'a\\b.ts'])('round-trips %s through its workspace URI', (name) => {
    const context = { root: '/workspace', workspaceRoot: '/workspace' }
    const fileName = `/workspace/${name}`
    const uri = documentUriForFileName(context, fileName)
    expect(uri).toBe(`file:///${encodeURIComponent(name)}`)
    expect(fileNameForUri(context, uri)).toBe(fileName)
  })
})
