import '@singapore-editor/core/style.css'
import { Editor } from '@singapore-editor/core'
import type { EditorPlugin, EditorViewContributionInput } from '@singapore-editor/core/extensions'

type Setup = { readonly interested: number; readonly irrelevant: number }
type Sample = { readonly medianUs: number; readonly calls: number }

let editor: Editor | null = null
let calls = 0

function piece(inputs: readonly EditorViewContributionInput[]): EditorPlugin {
  return {
    name: `dispatch-${inputs.join('-')}`,
    activate: (context) =>
      context.registerViewContribution({
        createContribution: () => ({
          inputs,
          update: () => void (calls += 1),
          dispose: () => undefined,
        }),
      }),
  }
}

function text(lines: number): string {
  return Array.from({ length: lines }, (_, index) => `line ${index} value`).join('\n')
}

async function setup({ interested, irrelevant }: Setup): Promise<void> {
  editor?.dispose()
  const host = document.getElementById('host')!
  host.replaceChildren()
  host.style.cssText = 'width:1000px;height:700px;display:flex'
  const plugins = [
    ...Array.from({ length: interested }, () => piece(['selection'])),
    ...Array.from({ length: irrelevant }, () => piece(['tokens'])),
  ]
  editor = new Editor(host, { defaultText: text(20_000), plugins })
  // @justification Benchmark harness: two frames let the editor mount before any pass is timed.
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
}

// A pass with no editor operation around it: the dispatch, one snapshot and every called update.
async function measure(): Promise<Sample> {
  const controller = Reflect.get(editor!, 'viewContributions') as {
    notify(kind: 'selection'): void
  }
  const batches: number[] = []
  calls = 0
  for (let batch = 0; batch < 12; batch += 1) {
    const start = performance.now()
    for (let index = 0; index < 400; index += 1) controller.notify('selection')
    batches.push(((performance.now() - start) / 400) * 1000)
    // @justification Benchmark harness: one frame between batches keeps them apart.
    await new Promise((resolve) => requestAnimationFrame(resolve))
  }
  const sorted = batches.slice(2).sort((left, right) => left - right)
  return { medianUs: sorted[Math.floor(sorted.length / 2)]!, calls: calls / (12 * 400) }
}

;(window as unknown as { dispatch: unknown }).dispatch = { setup, measure }
