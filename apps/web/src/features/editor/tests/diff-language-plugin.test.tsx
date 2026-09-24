import type {
  EditorPlugin,
  EditorPressParticipant,
  EditorViewContribution,
} from '@singapore-editor/core/extensions'

import {
  createDiffLanguagePlugin,
  type DiffLanguageOptions,
} from '@/features/editor/utils/diff-language-plugin'
import { expect, test } from '../../../../test/fixtures'

type HitTest = { readonly x: number; readonly y: number }

/** Everything the contribution reaches for, and a record of the hit tests it asked for. */
function mountContribution(hits: HitTest[], askable = false) {
  const element = document.createElement('div')
  document.body.appendChild(element)

  const options: DiffLanguageOptions = {
    bufferOffsetAt: () => null,
    definition: () => Promise.resolve({ kind: 'none' }),
    hover: () => Promise.resolve(null),
    resolve: () =>
      askable
        ? { kind: 'ask', side: 'new', position: { line: 0, character: 0 } }
        : { kind: 'unavailable', reason: 'not-a-file-line' },
    theme: () => null,
  }

  // The editor asks these before it turns a press into a caret; this stands in for that dispatch.
  const pressParticipants: EditorPressParticipant[] = []
  const viewContext = {
    scrollElement: element,
    registerPressParticipant: (participant: EditorPressParticipant) => {
      pressParticipants.push(participant)
      return { dispose: () => undefined }
    },
    focusEditor: () => undefined,
    getRangeClientRect: () => null,
    registerProvider: () => ({ dispose: () => undefined }),
    setSelection: () => undefined,
    textOffsetFromPoint: (x: number, y: number) => {
      hits.push({ x, y })
      return askable ? 0 : null
    },
  }

  let contribution: EditorViewContribution | null = null
  const activate = createDiffLanguagePlugin(options).activate as EditorPlugin['activate']
  activate({
    registerViewContribution: ({
      createContribution,
    }: {
      createContribution: (context: unknown) => EditorViewContribution
    }) => {
      contribution = createContribution(viewContext)
      return { dispose: () => undefined }
    },
  } as never)

  const press = (event: MouseEvent) => pressParticipants.some((participant) => participant(event))
  return { contribution: contribution as unknown as EditorViewContribution, element, press }
}

function moveTo(element: HTMLElement, clientX: number, clientY: number) {
  element.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX, clientY }))
}

function nextFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

test('a burst of pointer movement costs one hit test, at the position it ended on', async () => {
  const hits: HitTest[] = []
  const { contribution, element } = mountContribution(hits)

  for (let step = 0; step < 8; step += 1) moveTo(element, 10 + step, 20 + step)
  expect(hits).toEqual([])

  await nextFrame()
  await nextFrame()

  expect(hits).toEqual([{ x: 17, y: 27 }])
  contribution.dispose()
})

test('following a definition drops the move queued behind it', async () => {
  const hits: HitTest[] = []
  const { contribution, element, press } = mountContribution(hits, true)

  moveTo(element, 40, 50)
  const claimed = press(
    new MouseEvent('mousedown', { button: 0, clientX: 40, clientY: 50, metaKey: true }),
  )
  expect(claimed).toBe(true)
  hits.length = 0

  await nextFrame()
  await nextFrame()

  // The click already hid the tooltip and went to the definition; the frame queued behind it must
  // not hit-test that stale position and put the tooltip back.
  expect(hits).toEqual([])
  contribution.dispose()
})

test('leaving the diff drops a move that has not been answered yet', async () => {
  const hits: HitTest[] = []
  const { contribution, element } = mountContribution(hits)

  moveTo(element, 40, 50)
  element.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))

  await nextFrame()
  await nextFrame()

  expect(hits).toEqual([])
  contribution.dispose()
})
