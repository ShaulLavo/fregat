import '@workspace/ui/globals.css'
import '@singapor/core/style.css'
import type { EditorTextAnchor } from '@singapor/core/extensions'
import type {
  LanguageServerDiagnosticMarkerClaim,
  LanguageServerDiagnosticMarkerEvent,
} from '@singapor/lsp-plugin'
import { useEditor } from '@singapor/react'
import { StrictMode, useLayoutEffect, useMemo } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'

import { DiagnosticPeek } from '@/features/editor/components/diagnostic-peek'
import { EditorFrame } from '@/features/editor/components/frame'
import { useDiagnosticPeek } from '@/features/editor/hooks/use-diagnostic-peek'
import { useFocusTarget } from '@/lib/focus/hooks/use-target'
import { AppProviders, createTestQueryClient } from '../../../../test/render'

type BrowserRuntime = {
  readonly claim: (
    event: LanguageServerDiagnosticMarkerEvent,
  ) => LanguageServerDiagnosticMarkerClaim
  readonly controller: ReturnType<typeof useEditor>
}

const FILE_PATH = 'repo/a.ts'
const DOCUMENT_TEXT = [
  'alpha world gamma',
  ...Array.from({ length: 80 }, (_, index) => `line ${index}`),
].join('\n')
let root: Root | null = null
let runtime: BrowserRuntime | null = null

afterEach(() => {
  root?.unmount()
  root = null
  runtime = null
  document.body.replaceChildren()
})

test('anchors the diagnostic React surface through edits and restores editor focus', async () => {
  mountHarness()
  await expect.poll(() => runtime?.controller.getEditor()).toBeTruthy()
  const current = requiredRuntime()
  current.controller.commands.focus()
  await expect.poll(() => document.activeElement?.getAttribute('aria-label')).toBe('Editor input')

  const first = current.claim(markerEvent(currentVersion(), rangeAnchor(6, 11)))
  expect(first.kind).toBe('claimed')
  await expect.poll(() => document.querySelector('[data-diagnostic-peek]')).not.toBeNull()
  const initialLeft = peekLeft()

  current.controller.commands.edit({ from: 0, to: 0, text: '>> ' })
  await expect.poll(peekLeft).not.toBe(initialLeft)

  current.controller.getEditor()?.setScrollPosition({ top: 800 })
  await expect.poll(() => document.querySelector('[data-diagnostic-peek]')).toBeNull()
  current.controller.getEditor()?.setScrollPosition({ top: 0 })
  await expect.poll(() => document.querySelector('[data-diagnostic-peek]')).not.toBeNull()

  const close = document.querySelector<HTMLButtonElement>('[aria-label="Close diagnostic"]')!
  close.focus()
  expect(document.activeElement).toBe(close)
  const before = current.controller.materializeFullText()
  close.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, data: 'x' }))
  close.dispatchEvent(new ClipboardEvent('paste', { bubbles: true }))
  expect(current.controller.materializeFullText()).toBe(before)

  const editorInput = document.querySelector<HTMLElement>('[aria-label="Editor input"]')!
  editorInput.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  await expect.poll(() => document.querySelector('[data-diagnostic-peek]')).toBeNull()

  const replacement = current.claim(markerEvent(currentVersion(), rangeAnchor(9, 14)))
  expect(replacement.kind).toBe('claimed')
  await expect.poll(() => document.querySelector('[data-diagnostic-peek]')).not.toBeNull()
  const replacementClose = document.querySelector<HTMLButtonElement>(
    '[aria-label="Close diagnostic"]',
  )!
  replacementClose.focus()
  replacementClose.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
  await expect.poll(() => document.querySelector('[data-diagnostic-peek]')).toBeNull()
  await expect.poll(() => document.activeElement?.getAttribute('aria-label')).toBe('Editor input')

  const point = current.claim(markerEvent(currentVersion(), pointAnchor(4)))
  expect(point.kind).toBe('claimed')
  await expect.poll(() => document.querySelector('[data-diagnostic-peek]')).not.toBeNull()

  current.controller.commands.edit({ from: 0, to: 5, text: '' })
  await expect.poll(() => document.querySelector('[data-diagnostic-peek]')).toBeNull()

  const tallEvent = markerEvent(currentVersion(), pointAnchor(1))
  const tall = current.claim({
    ...tallEvent,
    diagnostic: {
      ...tallEvent.diagnostic,
      message: Array.from({ length: 30 }, () => 'Long diagnostic detail').join('\n'),
    },
  })
  expect(tall.kind).toBe('claimed')
  await expect.poll(() => document.querySelector('[data-diagnostic-peek]')).not.toBeNull()
  const tallPeek = document.querySelector<HTMLElement>('[data-diagnostic-peek]')!
  const frame = document.querySelector<HTMLElement>('[data-editor-focus-active]')!
  expect(tallPeek.scrollHeight).toBeGreaterThan(tallPeek.clientHeight)
  expect(tallPeek.getBoundingClientRect().bottom).toBeLessThanOrEqual(
    frame.getBoundingClientRect().bottom,
  )
})

function mountHarness(): void {
  const host = document.createElement('main')
  host.style.height = '220px'
  host.style.position = 'relative'
  host.style.width = '540px'
  document.body.append(host)
  root = createRoot(host)
  flushSync(() => {
    root?.render(
      <StrictMode>
        <AppProviders command={false} queryClient={createTestQueryClient()}>
          <BrowserHarness />
        </AppProviders>
      </StrictMode>,
    )
  })
}

function BrowserHarness() {
  const diagnosticPeek = useDiagnosticPeek({ active: true, filePath: FILE_PATH })
  const plugins = useMemo(() => [diagnosticPeek.plugin], [diagnosticPeek.plugin])
  const controller = useEditor({
    document: { documentId: FILE_PATH, languageId: 'typescript', text: DOCUMENT_TEXT },
    plugins,
  })
  const focusTarget = useFocusTarget<HTMLDivElement>({
    area: 'editor',
    capabilities: { editor: { dispatch: controller.commands.dispatchCommand, writable: true } },
    id: { key: FILE_PATH, kind: 'editor', surface: 'document', tabId: 'tab-a' },
    onIntent: (intent) => {
      if (intent !== 'focus') return false
      controller.commands.focus()
      return true
    },
  })

  useLayoutEffect(() => {
    runtime = { claim: diagnosticPeek.onDidNavigateDiagnostic, controller }
    return () => {
      runtime = null
    }
  }, [controller, diagnosticPeek.onDidNavigateDiagnostic])

  return (
    <EditorFrame
      active={focusTarget.focused}
      controller={controller}
      onRequestCloseOverlay={diagnosticPeek.snapshot ? diagnosticPeek.close : undefined}
      targetRef={focusTarget.ref}
    >
      {diagnosticPeek.snapshot ? (
        <DiagnosticPeek
          model={diagnosticPeek.snapshot}
          onClose={diagnosticPeek.close}
          tabId='tab-a'
        />
      ) : null}
    </EditorFrame>
  )
}

function markerEvent(
  textVersion: number,
  anchor: EditorTextAnchor,
): LanguageServerDiagnosticMarkerEvent {
  return {
    anchor,
    diagnostic: {
      message: 'Unknown name',
      severity: 1,
      source: 'typescript',
      range: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } },
    },
    direction: 'next',
    documentUri: 'file:///repo/a.ts',
    textVersion,
  }
}

function rangeAnchor(start: number, end: number) {
  return { kind: 'range', start, end, startBias: 'right', endBias: 'left' } as const
}

function pointAnchor(offset: number) {
  return { kind: 'point', offset, bias: 'right' } as const
}

function requiredRuntime(): BrowserRuntime {
  if (!runtime) throw new TypeError('Diagnostic peek browser runtime is unavailable')
  return runtime
}

function currentVersion(): number {
  return requiredRuntime().controller.getSnapshot()?.textVersion ?? -1
}

function peekLeft(): number {
  const value = document.querySelector<HTMLElement>('[data-diagnostic-peek]')?.style.left
  return value ? Number.parseFloat(value) : Number.NaN
}
