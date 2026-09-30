import { describe, expect, it } from 'vitest'

import type { SourceFile } from '../../src/githubSource.ts'
import { createSidebar } from '../../src/components/sidebar.ts'

describe('createSidebar', () => {
  it('renders a repository tree, selects files, and clears restored expansion state', async () => {
    const sidebar = createSidebar()
    const selectedFiles: string[] = []
    const files = [
      sourceFile('src/main.ts', 'console.log(1);'),
      sourceFile('README.md', '# Project'),
    ]

    await sidebar.renderSource(files, (file) => {
      selectedFiles.push(`${file.path}:${file.text}`)
    })

    expect(entryLabels(sidebar.element)).toEqual(['src', 'README.md'])

    await clickEntry(sidebar.element, 'src')
    await waitForEntry(sidebar.element, 'main.ts')
    expect(entryLabels(sidebar.element)).toEqual(['src', 'main.ts', 'README.md'])

    await clickEntry(sidebar.element, 'main.ts')
    await waitForSelectedFile(selectedFiles)
    expect(selectedFiles).toEqual(['src/main.ts:console.log(1);'])

    sidebar.clear()
    expect(sidebar.element.childElementCount).toBe(0)

    await sidebar.renderSource(files, () => undefined, { preserveExpandedPaths: true })
    expect(entryLabels(sidebar.element)).toEqual(['src', 'README.md'])
  })
})

function entryLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.entry')).map((entry) =>
    (entry.textContent ?? '').slice(3),
  )
}

async function clickEntry(container: HTMLElement, name: string): Promise<void> {
  const entry = Array.from(container.querySelectorAll('.entry')).find((candidate) =>
    candidate.textContent?.endsWith(name),
  )
  if (!(entry instanceof HTMLElement)) throw new Error(`Missing tree entry: ${name}`)
  entry.click()
}

async function waitForEntry(container: HTMLElement, name: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (entryLabels(container).includes(name)) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  throw new Error(`Timed out waiting for tree entry: ${name}`)
}

async function waitForSelectedFile(selectedFiles: readonly unknown[]): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (selectedFiles.length > 0) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  throw new Error('Timed out waiting for file selection')
}

function sourceFile(path: string, text: string): SourceFile {
  return {
    path,
    text,
    sha: `${path}-sha`,
    size: text.length,
  }
}
