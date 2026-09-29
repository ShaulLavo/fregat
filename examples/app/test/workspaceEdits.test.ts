import { describe, expect, it } from 'vitest'
import { applyTextEdits } from '../src/workspaceEdits.ts'

const at = (line: number, character: number) => ({ line, character })

describe('applyTextEdits', () => {
  it('keeps inserts at one position in the order the edit lists them', () => {
    const text = 'const circle = 1\n'

    const edited = applyTextEdits(text, [
      { range: { start: at(0, 0), end: at(0, 0) }, newText: "import { a } from './a'\n" },
      { range: { start: at(0, 0), end: at(0, 0) }, newText: "import { b } from './b'\n" },
    ])

    expect(edited).toBe("import { a } from './a'\nimport { b } from './b'\nconst circle = 1\n")
  })

  it('measures every edit against the text before any of them', () => {
    const edited = applyTextEdits('one two three', [
      { range: { start: at(0, 0), end: at(0, 3) }, newText: '1' },
      { range: { start: at(0, 8), end: at(0, 13) }, newText: '3' },
    ])

    expect(edited).toBe('1 two 3')
  })
})
