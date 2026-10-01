import {
  createDocumentTextSnapshot,
  createPieceTableSnapshot,
} from '@singapore-editor/core/document'
import { createDiffPlugin, joinRenderLines, type DiffGutterSide } from '@singapore-editor/diff'
import { editorDiffFiles, renderableDiffFile } from '@workspace/client-core/git/diff-files'
import { describe } from 'vitest'

import { createDiffPositionMap } from '@/features/editor/utils/diff-position-map'
import { historyRepository } from '../../../../../test/factories/git-history'
import { expect, test } from '../../../../../test/fixtures'

// A file diffed through the real git server keeps every CR and byte order mark `git cat-file`
// returns. Each `const` names its line, and the map must answer with the position an opened copy
// of that side holds it at: a CRLF is one break, a lone CR another, and the byte order mark is gone.
const OLD = '﻿const a = 1;\r\nconst b = 2;\r\r\nconst c = 3;\rconst d = 4;\r\n'
const NEW = '﻿const a = 1;\r\nconst bb = 2;\r\r\nconst c = 3;\nconst d = 4;\rconst e = 5;\r\n'

/** The text an editor holds after `setText(text)`. */
function opened(text: string): string {
  return createDocumentTextSnapshot(createPieceTableSnapshot(text)).materializeFullText()
}

describe('positions in a diff from the real git server', () => {
  test.for<DiffGutterSide>(['stacked', 'old', 'new'])(
    'the %s pane maps each buffer offset to its opened file position',
    async (side, { client, server }) => {
      const repo = await historyRepository(server.root)
      repo.git('config', 'core.autocrlf', 'false')
      await repo.write('a.ts', OLD)
      repo.commit('init')
      await repo.write('a.ts', NEW)
      const { data: diffs } = await client.git.diff.get({
        query: { path: 'history-repo/a.ts', staged: false },
      })
      // The server decodes blobs as UTF-8, which spends the byte order mark; every CR arrives.
      expect(diffs?.[0]?.newText).toBe(NEW.slice(1))
      const file = renderableDiffFile(editorDiffFiles(diffs ?? []))!
      const plugin = createDiffPlugin({ mode: 'document', side, syntaxHighlight: false })
      plugin.setFile(file)
      const rows = plugin.getRows()
      const buffer = opened(joinRenderLines(rows))
      expect.soft(buffer).toBe(rows.map((row) => row.text).join('\n'))

      const files = { new: opened(NEW).split('\n'), old: opened(OLD).split('\n') }
      const map = createDiffPositionMap(rows, file.newLines, file.oldLines)
      const named = [...buffer.matchAll(/const (\w+)/g)].map((match) => {
        const name = match[1]!
        const offset = match.index + 6
        const lookup = map.lookupAt(offset)
        if (lookup.kind !== 'file') return { name, found: null, roundTrip: false }
        const { character, line } = lookup.position
        const found = files[lookup.side][line]?.slice(character, character + 1) ?? null
        const roundTrip = map.bufferOffsetAt(lookup.side, lookup.position) === offset
        return { name, found, roundTrip }
      })
      expect(named).toEqual(
        named.map(({ name }) => ({ name, found: name.slice(0, 1), roundTrip: true })),
      )
    },
  )
})
