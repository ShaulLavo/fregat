import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, test } from 'vitest'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const removedDirectory = path.join(root, 'packages/editor/src', 'pieceTable')

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', 'dist', '.turbo', 'coverage'].includes(entry.name)) return []
    const filename = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(filename)
    return /\.(?:ts|tsx|js|mjs|cjs)$/.test(entry.name) ? [filename] : []
  })
}

describe('direct textbuffer imports', () => {
  test('does not restore an editor-local piece-table facade', () => {
    expect(existsSync(removedDirectory)).toBe(false)
  })

  test('has no source, test, or benchmark imports through the removed directory', () => {
    const violations: string[] = []
    for (const directory of ['packages', 'examples', 'scripts']) {
      for (const filename of sourceFiles(path.join(root, directory))) {
        const source = readFileSync(filename, 'utf8')
        for (const imported of ts.preProcessFile(source, true, true).importedFiles) {
          if (!imported.fileName.startsWith('.')) continue
          const resolved = path.resolve(path.dirname(filename), imported.fileName)
          if (resolved === removedDirectory || resolved.startsWith(removedDirectory + path.sep)) {
            violations.push(path.relative(root, filename) + ': ' + imported.fileName)
          }
        }
      }
    }
    expect(violations).toEqual([])
  })
})
