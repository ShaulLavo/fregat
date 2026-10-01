import {
  createDocumentTextSnapshot,
  createPieceTableSnapshot,
} from '@singapore-editor/core/document'
import { createDiffPlugin, joinRenderLines, type DiffGutterSide } from '@singapore-editor/diff'
import { editorDiffFiles, renderableDiffFile } from '@workspace/client-core/git/diff-files'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe } from 'vitest'

import { getClient } from '@/lib/client'
import { createDiffPositionMap } from '@/features/editor/utils/diff-position-map'
import * as api from '@/features/git/utils/api'
import { runGit } from '../../../../test/factories/git'
import { expect, test } from '../../../../test/fixtures'

// A Windows-authored file diffed through the real server: `git cat-file` keeps every CR, and the
// diff editor folds the text its host pushes. Each `const` names its file line, so a buffer offset
// that drifts lands on the wrong character.
const OLD = 'const a = 1;\r\nconst b = 2;\r\nconst c = 3;\r\nconst d = 4;\r\n'
const NEW = 'const a = 1;\r\nconst bb = 2;\r\nconst c = 3;\nconst d = 4;\r\nconst e = 5;\r\n'

async function crlfRepo(root: string) {
  const repo = path.join(root, 'repo')
  await mkdir(repo, { recursive: true })
  const git = (...args: string[]) => runGit(repo, args, { cwdMode: 'option' })
  git('init', '-b', 'main')
  git('config', 'core.autocrlf', 'false')
  git('config', 'commit.gpgsign', 'false')
  await writeFile(path.join(repo, 'a.ts'), OLD)
  git('add', 'a.ts')
  git('commit', '-m', 'init')
  await writeFile(path.join(repo, 'a.ts'), NEW)
}

/** The text an editor holds after `setText(text)`: folded as it ingests a file. */
function folded(text: string): string {
  return createDocumentTextSnapshot(createPieceTableSnapshot(text)).materializeFullText()
}

describe('a CRLF file diff from the real git server', () => {
  test.for<DiffGutterSide>(['stacked', 'old', 'new'])(
    'the %s pane maps every buffer offset to its file line',
    async (side, { client, server }) => {
      void client
      await crlfRepo(server.root)
      const diffs = await api.fetchDiff('repo/a.ts', false, undefined, getClient())
      expect(diffs[0]?.newText).toBe(NEW)
      const file = renderableDiffFile(editorDiffFiles(diffs))!
      const plugin = createDiffPlugin({ mode: 'document', side, syntaxHighlight: false })
      plugin.setFile(file)
      const rows = plugin.getRows()
      const buffer = folded(joinRenderLines(rows))
      expect.soft(buffer).toBe(joinRenderLines(rows))

      const map = createDiffPositionMap(rows, file.newLines, file.oldLines)
      const named = [...buffer.matchAll(/const (\w+)/g)].map((match) => {
        const lookup = map.lookupAt(match.index + 6)
        if (lookup.kind !== 'file') return [match[1], null]
        const lines = lookup.side === 'new' ? NEW : OLD
        const line = lines.split('\n')[lookup.position.line] ?? ''
        return [match[1], line.slice(lookup.position.character, lookup.position.character + 1)]
      })
      expect(named).toEqual(named.map(([name]) => [name, name!.slice(0, 1)]))
    },
  )
})
