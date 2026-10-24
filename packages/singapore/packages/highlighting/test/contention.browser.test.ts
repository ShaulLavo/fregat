import { expect, test } from 'vitest'

import { createHighlightingService, type HighlightTheme } from '../src/index'

// A Settings preview sample, and the number of previews one scrolled screen of theme rows asks for.
const SAMPLE = [
  '// Format a project for the sidebar.',
  'type Project = { name: string; stars: number };',
  'export function formatProject(project: Project) {',
  '  const { name, stars } = project;',
  '  return `${name} has ${stars} stars`;',
  '}',
].join('\n')
const BURST = 12
const PALETTE: HighlightTheme = {
  format: 'editor',
  definition: { syntax: { keyword: '#ff0000', comment: '#00ff00' } },
}

function vscode(index: number): HighlightTheme {
  return {
    format: 'vscode',
    definition: {
      name: `burst-${index}`,
      tokenColors: [
        { scope: ['keyword'], settings: { foreground: `#${index}0${index}0${index}0` } },
      ],
    },
  }
}

async function timed(run: () => Promise<unknown>): Promise<number> {
  const started = performance.now()
  await run()
  return performance.now() - started
}

// Measures, and fails only on a stall: previews share the workers with editor documents, and the
// plan asks for numbers before any scheduling machinery.
test('an interactive request waits behind at most one burst of previews', async () => {
  const service = createHighlightingService()
  const interactive = (theme: HighlightTheme) => () =>
    service.highlight('const x = 1', { language: 'typescript', theme })
  try {
    // Warm both engines, grammars and the palette's session path.
    await service.highlight(SAMPLE, { language: 'typescript', theme: vscode(0) })
    await service.highlight(SAMPLE, { language: 'typescript', theme: PALETTE })

    const rows: Record<string, number> = {}
    for (const [engine, theme] of [
      ['shiki', vscode(0)],
      ['tree-sitter', PALETTE],
    ] as const) {
      rows[`${engine} alone ms`] = await timed(interactive(theme))
      const burst = Array.from({ length: BURST }, (_, index) =>
        service.highlight(SAMPLE, {
          language: 'typescript',
          theme: engine === 'shiki' ? vscode(index + 1) : PALETTE,
        }),
      )
      rows[`${engine} behind ${BURST} previews ms`] = await timed(interactive(theme))
      rows[`${engine} burst total ms`] = await timed(() => Promise.all(burst))
    }
    console.info(`contention ${JSON.stringify(rows)}`)
    for (const value of Object.values(rows)) expect(value).toBeLessThan(5_000)
  } finally {
    await service.dispose()
  }
})
