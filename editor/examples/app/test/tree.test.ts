import { describe, expect, it } from 'vitest'

import type { SourceFile } from '../src/githubSource.ts'
import { buildSourceTree, renderTree } from '../src/tree.ts'

describe('renderTree', () => {
  it('sorts directories before files and auto-selects the requested file', async () => {
    const container = document.createElement('div')
    const selectedFiles: string[] = []
    const files = [
      sourceFile('zeta.ts', 'z'),
      sourceFile('src/main.ts', 'main'),
      sourceFile('alpha.ts', 'a'),
    ]

    await renderTree(
      buildSourceTree(files),
      container,
      (file) => {
        selectedFiles.push(`${file.path}:${file.text}`)
      },
      {
        selectedPath: 'alpha.ts',
      },
    )

    expect(entryLabels(container)).toEqual(['src', 'alpha.ts', 'zeta.ts'])
    expect(selectedFiles).toEqual(['alpha.ts:a'])
    expect(container.querySelector('.entry.active')?.textContent).toContain('alpha.ts')
  })

  it('restores expanded directories and reports toggles', async () => {
    const container = document.createElement('div')
    const toggles: Array<{ path: string; open: boolean }> = []
    const files = [sourceFile('src/main.ts', 'main')]

    await renderTree(buildSourceTree(files), container, () => undefined, {
      expandedPaths: new Set(['src/']),
      onDirectoryToggle: (path, open) => toggles.push({ path, open }),
    })

    expect(entryLabels(container)).toEqual(['src', 'main.ts'])
    expect(toggles).toEqual([{ path: 'src/', open: true }])

    clickEntry(container, 'src')
    expect(toggles).toEqual([
      { path: 'src/', open: true },
      { path: 'src/', open: false },
    ])
  })
})

function entryLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.entry')).map((entry) =>
    (entry.textContent ?? '').slice(3),
  )
}

function clickEntry(container: HTMLElement, name: string): void {
  const entry = Array.from(container.querySelectorAll('.entry')).find((candidate) =>
    candidate.textContent?.endsWith(name),
  )
  if (!(entry instanceof HTMLElement)) throw new Error(`Missing tree entry: ${name}`)
  entry.click()
}

function sourceFile(path: string, text: string): SourceFile {
  return {
    path,
    text,
    sha: `${path}-sha`,
    size: text.length,
  }
}
