import { expect, test } from 'vitest'
import { commands } from 'vitest/browser'
import type { RetentionAcceptanceReloadResult } from '../../../../retention-acceptance.vitest.config'
import { retentionAcceptanceReloadFrameOutcome } from '../../../../test/factories/retention-acceptance-reload-frame'

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
        const outcome = retentionAcceptanceReloadFrameOutcome({
          frame,
          settledReference,
          expectedPath: 'repo/src/editor-tab-a.ts',
          syntax: arm.syntax,
          currentReady,
        })
        expect(outcome.kind, JSON.stringify({ at: frame.at, outcome })).not.toBe('mismatch')
        if (outcome.kind === 'current') currentReady = true
      }
      expect(currentReady).toBe(true)
      if (arm.font === 'slow') {
        expect(result.fontLoadReceipt.faceCount).toBeGreaterThan(0)
        expect(result.fontLoadReceipt.codeLoaded).toBe(true)
        expect(result.fontLoadReceipt.status).toBe('loaded')
        const endpoint = result.frames?.slice(-2)
        expect(endpoint?.length).toBe(2)
        for (const frame of endpoint ?? []) {
          expect(frame.fonts).toEqual({ status: 'loaded', codeLoaded: true })
          expect(
            retentionAcceptanceReloadFrameOutcome({
              frame,
              settledReference,
              expectedPath: 'repo/src/editor-tab-a.ts',
              syntax: arm.syntax,
              currentReady: true,
            }).kind,
          ).toBe('current')
        }
      }
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
