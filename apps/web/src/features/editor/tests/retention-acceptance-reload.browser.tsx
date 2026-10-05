import { expect, test } from 'vitest'
import { commands } from 'vitest/browser'
import type { RetentionAcceptanceReloadResult } from '../../../../retention-acceptance.vitest.config'
import { tokenPaintMismatch } from '../../../../../../scripts/agent/scenarios/editor-tab-hover-highlights-probe'

declare module 'vitest/browser' {
  interface BrowserCommands {
    retentionAcceptanceReload(arm: {
      readonly syntax: 'colored' | 'plain'
      readonly font: 'normal' | 'slow'
      readonly saved: 'present' | 'absent'
    }): Promise<RetentionAcceptanceReloadResult>
  }
}

for (const arm of [
  { syntax: 'plain', font: 'normal' },
  { syntax: 'colored', font: 'normal' },
  { syntax: 'plain', font: 'slow' },
  { syntax: 'colored', font: 'slow' },
] as const)
  test(
    `real page reload restores ${arm.syntax} canonical source with ${arm.font} fonts and no saved paint`,
    { timeout: 30_000 },
    async (context) => {
      const result = await commands.retentionAcceptanceReload({
        ...arm,
        saved: 'absent',
      })
      await context.annotate(
        JSON.stringify({
          arm: result.arm,
          output: result.output,
          screenshot: result.screenshot,
          frames: result.frames?.length,
          delayedFonts: result.delayedFonts,
          setup: result.setup,
        }),
        'retention-acceptance-real-reload',
      )
      expect(result.errors).toEqual([])
      expect(result.cacheReceipt?.remainingSavedKeys).toEqual([])
      expect(result.frames?.length).toBeGreaterThan(0)
      if (arm.font === 'slow') expect(result.delayedFonts.length).toBeGreaterThan(0)
      const settledReference =
        result.after?.kind === 'mounted'
          ? result.after.views.find((view) => view.kind === 'observed')?.reference
          : undefined
      expect(settledReference).toBeDefined()
      if (!settledReference) return
      let currentReady = false
      for (const frame of result.frames ?? []) {
        if (!frame.editor || frame.rows.length === 0) continue
        expect(frame.observation?.kind, `frame at ${frame.at}`).toBe('mounted')
        if (frame.observation?.kind !== 'mounted') continue
        const visible = frame.observation.views.find((view) => 'frame' in view)
        if (
          !currentReady &&
          arm.syntax === 'colored' &&
          visible?.kind === 'unready' &&
          'syntaxStatus' in visible &&
          visible.frame !== undefined &&
          visible.currentIdentity !== undefined &&
          visible.source !== undefined
        ) {
          expect(visible.syntaxStatus).toBe('loading')
          expect(['loading', 'painted']).toContain(visible.initialHighlightStatus)
          expect(visible.paintLayers).toBeNull()
          expect(visible.frame.identity).toEqual(visible.currentIdentity)
          expect(visible.headerPath).toBe('repo/src/editor-tab-a.ts')
          expect(frame.input).toEqual({ mounted: true, readonly: false, disabled: false })
          expect(visible.source).toBe(settledReference.source)
          const reference =
            visible.initialHighlightStatus === 'painted'
              ? settledReference
              : {
                  identity: visible.currentIdentity,
                  source: visible.source,
                  runs: [],
                  expected: 'plain' as const,
                }
          expect(tokenPaintMismatch(visible.frame, reference)).toBeNull()
          continue
        }
        expect(visible?.kind, `presented frame at ${frame.at}`).toBe('observed')
        if (visible?.kind !== 'observed') continue
        currentReady = true
        expect(visible.reference.expected).toBe(arm.syntax)
        expect(visible.mismatch, `presented frame at ${frame.at}`).toBeNull()
      }
      expect(currentReady).toBe(true)
      expect(result.before?.kind).toBe('mounted')
      expect(result.after?.kind).toBe('mounted')
      if (result.before?.kind !== 'mounted' || result.after?.kind !== 'mounted') return
      const before = result.before.views.find((view) => view.kind === 'observed')
      const after = result.after.views.find((view) => view.kind === 'observed')
      expect(before?.kind).toBe('observed')
      expect(after?.kind).toBe('observed')
      if (before?.kind !== 'observed' || after?.kind !== 'observed') return
      expect(after.reference.source).toBe(before.reference.source)
      expect(after.reference.identity.document).toBe(before.reference.identity.document)
      expect(after.headerPath).toBe('repo/src/editor-tab-a.ts')
      expect(after.mismatch).toBeNull()
    },
  )

test(
  'real page reload admits actual saved paint provisionally',
  { timeout: 30_000 },
  async (context) => {
    const result = await commands.retentionAcceptanceReload({
      syntax: 'colored',
      font: 'normal',
      saved: 'present',
    })
    await context.annotate(
      JSON.stringify({ output: result.output, screenshot: result.screenshot, setup: result.setup }),
      'retention-acceptance-saved-admission',
    )
    expect(result.errors).toEqual([])
    expect(result.cacheReceipt?.remainingSavedKeys.length).toBeGreaterThan(0)
    const provisional = result.frames?.filter((frame) =>
      frame.rows.some((row) => row.html.includes('data-editor-provisional-row')),
    )
    expect(provisional?.length).toBeGreaterThan(0)
    expect(result.before?.kind).toBe('mounted')
    expect(result.after?.kind).toBe('mounted')
  },
)
