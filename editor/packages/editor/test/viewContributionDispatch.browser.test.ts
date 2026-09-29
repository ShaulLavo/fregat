import { afterEach, expect, it } from 'vitest'
import { Editor } from '../src/editor/Editor'
import type {
  EditorPlugin,
  EditorViewContributionContext,
  EditorViewContributionInput,
} from '../src/plugins'
import '../src/style.css'

const PIECES = 1_000
const LINE = 80
const restores: (() => void)[] = []

afterEach(() => {
  for (const restore of restores.splice(0)) restore()
})

type Counters = { calls: number; snapshots: number }

function fixture(lines: number): string {
  return Array.from({ length: lines }, (_, index) => `line ${index} `.padEnd(LINE - 1, 'x')).join(
    '\n',
  )
}

function piece(counters: Counters, inputs: readonly EditorViewContributionInput[]): EditorPlugin {
  return {
    name: `inert-${inputs.join('-')}`,
    activate: (context) =>
      context.registerViewContribution({
        createContribution: () => ({
          inputs,
          update: () => void (counters.calls += 1),
          dispose: () => undefined,
        }),
      }),
  }
}

async function mount(plugins: readonly EditorPlugin[], counters: Counters) {
  const host = document.createElement('div')
  host.style.cssText = 'width:1000px;height:700px;display:flex'
  document.body.append(host)
  const editor = new Editor(host, { defaultText: fixture(20_000), plugins: [...plugins] })
  restores.push(() => {
    editor.dispose()
    host.remove()
  })
  const createSnapshot = Reflect.get(editor, 'createViewSnapshot') as () => unknown
  Reflect.set(editor, 'createViewSnapshot', () => {
    counters.snapshots += 1
    return createSnapshot.call(editor)
  })
  await frames(2)
  editor.setSelection(10)
  await frames(1)
  counters.calls = 0
  counters.snapshots = 0
  return editor
}

const frames = async (count: number) => {
  for (let index = 0; index < count; index += 1) {
    await new Promise((resolve) => requestAnimationFrame(resolve))
  }
}

it('reaches selection-only pieces once per selection and keystroke, never on a page scroll', async () => {
  const counters: Counters = { calls: 0, snapshots: 0 }
  const plugins = Array.from({ length: PIECES }, () => piece(counters, ['selection']))
  const editor = await mount(plugins, counters)

  editor.setSelection(10 + LINE)
  expect(counters.calls).toBe(PIECES)

  counters.calls = 0
  editor.edit({ from: 12, to: 12, text: 'x' })
  expect(counters.calls).toBe(PIECES)

  counters.calls = 0
  counters.snapshots = 0
  editor.setScrollPosition({ top: 20_000 })
  await frames(2)
  expect(counters.calls).toBe(0)
  // No piece reads a scroll, so no pass builds a snapshot for one.
  expect(counters.snapshots).toBe(0)
})

it('re-runs only the contribution that asks for a view update', async () => {
  const counters: Counters = { calls: 0, snapshots: 0 }
  let requester: EditorViewContributionContext | null = null
  let asked = 0
  const asking: EditorPlugin = {
    name: 'asking',
    activate: (context) =>
      context.registerViewContribution({
        createContribution: (view) => {
          requester = view
          return { update: () => void (asked += 1), dispose: () => undefined }
        },
      }),
  }
  const others = Array.from({ length: 100 }, () => piece(counters, ['layout', 'content']))
  await mount([asking, ...others], counters)
  asked = 0

  if (!requester) throw new Error('the asking contribution was not created')
  ;(requester as EditorViewContributionContext).requestViewUpdate()

  expect(asked).toBe(1)
  expect(counters.calls).toBe(0)
})
