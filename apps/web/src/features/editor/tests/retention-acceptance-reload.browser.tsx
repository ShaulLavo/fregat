import { expect, test } from 'vitest'
import { commands } from 'vitest/browser'
import type { RetentionAcceptanceReloadResult } from '../../../../retention-acceptance.vitest.config'
import {
  retentionAcceptanceReloadFrameOutcome,
  type RetentionAcceptanceReloadAdmission,
} from '../../../../test/factories/retention-acceptance-reload-frame'

declare module 'vitest/browser' {
  interface BrowserCommands {
    retentionAcceptanceReload(
      arm: {
        readonly syntax: 'colored' | 'plain'
        readonly font: 'normal' | 'slow'
        readonly saved: 'present' | 'absent'
      },
      operationId: string,
    ): Promise<RetentionAcceptanceReloadResult>
    retentionAcceptanceReloadFinish(operationId: string): Promise<void>
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
      const operationId = crypto.randomUUID()
      context.onTestFinished(() => commands.retentionAcceptanceReloadFinish(operationId))
      const result = await commands.retentionAcceptanceReload(
        {
          ...arm,
          saved: 'absent',
        },
        operationId,
      )
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
      let admission: RetentionAcceptanceReloadAdmission = 'unbound'
      for (const frame of result.frames ?? []) {
        const outcome = retentionAcceptanceReloadFrameOutcome({
          frame,
          settledReference,
          expectedPath: 'repo/src/editor-tab-a.ts',
          syntax: arm.syntax,
          admission,
        })
        expect(
          outcome.kind,
          JSON.stringify({ at: frame.at, outcome, admission, frame, settledReference }),
        ).not.toBe('mismatch')
        if (outcome.kind === 'pending' && admission === 'unbound') admission = 'source'
        if (outcome.kind === 'current') admission = 'current'
      }
      expect(admission).toBe('current')
      if (arm.font === 'slow') {
        expect(result.fontLoadReceipt.faceCount).toBeGreaterThan(0)
        expect(result.fontLoadReceipt.codeLoaded).toBe(true)
        expect(result.fontLoadReceipt.status).toBe('loaded')
      }
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
            admission: 'current',
          }).kind,
        ).toBe('current')
      }
      const current = endpoint?.at(-1)
      if (current) assertCurrentFrameControls(current, settledReference, arm.syntax)
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
    const operationId = crypto.randomUUID()
    context.onTestFinished(() => commands.retentionAcceptanceReloadFinish(operationId))
    const result = await commands.retentionAcceptanceReload(
      {
        syntax: 'colored',
        font: 'normal',
        saved: 'present',
      },
      operationId,
    )
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

function assertCurrentFrameControls(
  frame: NonNullable<RetentionAcceptanceReloadResult['frames']>[number],
  settledReference: Parameters<typeof retentionAcceptanceReloadFrameOutcome>[0]['settledReference'],
  syntax: 'plain' | 'colored',
) {
  const visible = frame.observation?.kind === 'mounted' ? frame.observation.views[0] : null
  expect(visible?.kind).toBe('observed')
  if (visible?.kind !== 'observed') return
  const input = {
    frame,
    settledReference,
    expectedPath: 'repo/src/editor-tab-a.ts',
    syntax,
    admission: 'current',
  } as const
  expect(
    retentionAcceptanceReloadFrameOutcome({
      ...input,
      settledReference: { ...settledReference, source: 'wrong source' },
    }).kind,
  ).toBe('mismatch')
  const controls = [
    { ...visible, headerPath: null },
    { ...visible, initialHighlightStatus: 'loading' as const },
    { ...visible, publicCapture: null },
    { ...visible, frame: { ...visible.frame, rows: [] } },
    {
      ...visible,
      frame: {
        ...visible.frame,
        identity: {
          ...visible.frame.identity,
          revision: (settledReference.identity.revision ?? 0) + 1,
        },
      },
    },
  ]
  for (const control of controls)
    expect(
      retentionAcceptanceReloadFrameOutcome({
        ...input,
        frame: { ...frame, observation: { kind: 'mounted', views: [control] } },
      }).kind,
    ).toBe('mismatch')
  expect(
    retentionAcceptanceReloadFrameOutcome({ ...input, frame: { ...frame, rows: [] } }).kind,
  ).toBe('mismatch')
  if (syntax !== 'colored') return
  expect(visible.frame.runs.length).toBeGreaterThan(0)
  const runs = visible.frame.runs.map((run) => ({
    ...run,
    style: { ...run.style, color: 'rgb(0, 0, 0)' },
  }))
  expect(
    retentionAcceptanceReloadFrameOutcome({
      ...input,
      frame: {
        ...frame,
        observation: {
          kind: 'mounted',
          views: [{ ...visible, frame: { ...visible.frame, runs } }],
        },
      },
    }).kind,
  ).toBe('mismatch')
}
