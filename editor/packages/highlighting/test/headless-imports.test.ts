// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('loads published highlighting and diff syntax without view modules', () => {
  const result = spawnSync(
    'node',
    [
      '--input-type=module',
      '--eval',
      `
        import { registerHooks } from 'node:module'
        const loaded = []
        registerHooks({
          load(url, context, nextLoad) {
            loaded.push(url)
            return nextLoad(url, context)
          },
        })
        const { createHighlightingService } = await import('@singapore-editor/highlighting')
        const { prepareDiffSyntax } = await import('@singapore-editor/diff/syntax')
        const { EditorWorkScheduler } = await import('@singapore-editor/core/scheduling')
        console.log(JSON.stringify({
          service: typeof createHighlightingService,
          prepare: typeof prepareDiffSyntax,
          scheduler: typeof EditorWorkScheduler,
          loaded,
        }))
      `,
    ],
    { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' },
  )

  expect(result.status, result.stderr).toBe(0)
  const observed = JSON.parse(result.stdout) as {
    service: string
    prepare: string
    scheduler: string
    loaded: string[]
  }
  expect(observed.service).toBe('function')
  expect(observed.prepare).toBe('function')
  expect(observed.scheduler).toBe('function')
  expect(observed.loaded.some((url) => url.endsWith('/dist/diffSyntax.js'))).toBe(true)
  expect(observed.loaded.some((url) => url.endsWith('/editor/workScheduler.js'))).toBe(true)
  // Text analysis shares Unicode bidi data with the renderer.
  const virtualizationModules = observed.loaded
    .filter((url) => url.includes('/virtualization/'))
    .map((url) => url.split('/').at(-1))
  expect(virtualizationModules).toEqual(['bidiClassData.js'])
  expect(observed.loaded.some((url) => url.endsWith('/editorDiffPlugin.js'))).toBe(false)
})
