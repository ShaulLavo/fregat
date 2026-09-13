import { describe, expect, it } from 'vitest'
import type { LanguageServerDefinitionTarget } from '@singapore-editor/lsp-plugin'

import { openWorkspaceSearchMatch } from '@/features/search/utils/open-match'

describe('openWorkspaceSearchMatch', () => {
  it('opens file matches through the file surface command', () => {
    let openedPath: string | null = null

    openWorkspaceSearchMatch(
      {
        kind: 'name',
        path: 'repo/src/app.ts',
        source: 'disk',
        type: 'file',
      },
      'needle',
      {
        openDefinition: () => false,
        openFileSurface: (path) => {
          openedPath = path
        },
      },
    )

    expect(openedPath).toBe('repo/src/app.ts')
  })

  it('opens content matches at zero-based editor ranges', () => {
    let opened: LanguageServerDefinitionTarget | null = null

    openWorkspaceSearchMatch(
      {
        column: 7,
        endColumn: 13,
        kind: 'content',
        line: 3,
        path: 'repo/src/app.ts',
        source: 'disk',
        type: 'file',
      },
      'needle',
      {
        openFileSurface: () => {},
        openDefinition: (target) => {
          opened = target
          return true
        },
      },
    )

    expect(opened).toMatchObject({
      path: 'repo/src/app.ts',
      range: {
        end: { character: 12, line: 2 },
        start: { character: 6, line: 2 },
      },
    })
  })
})
