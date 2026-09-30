import { ok } from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { committedFixture, openFixtureWorkspace } from '../fixture-workspace'
import { checkoutRoot } from '../paths'
import { mermaidSelectors, selectors } from '../selectors'
import { typeEditorBurst } from './editor-type-burst'
import { isolatedNativeScenario, sendPrompt } from './native-provider-verification'

export const editorMermaidStyle = styleScenario('editor-mermaid-style', 30)
export const editorStyleBaseline = styleScenario('editor-style-baseline', 0)

function styleScenario(name: string, count: number) {
  return isolatedNativeScenario({
    name,
    description: `Type the standard editor burst with ${count} copies of the rendered chat diagram mounted offscreen, retaining its display boundary.`,
    fixture: new URL('../fixtures/native-codex.mjs', import.meta.url),
    async prepareWorktree() {
      const fixture = await committedFixture('mermaid-style')
      await writeFile(
        join(fixture.path, 'a.txt'),
        'A measured editor line with stable text and layout.\n'.repeat(150),
      )
      return fixture
    },
    async drive(page, { step }) {
      await sendPrompt(page, 'Render the Mermaid style-cost fixture.')
      const diagram = page.locator(mermaidSelectors.diagram).first()
      await diagram.locator(mermaidSelectors.svg).waitFor({ timeout: 30_000 })
      const boundary = await diagram.evaluate(copyDiagrams, count)
      ok(boundary, 'The diagram fixture rendered')
      await selectors.workspaceMode(page, 'Workbench').click()
      await step(`mounted-${count}-${boundary}-diagrams`)
      try {
        await typeEditorBurst(page, { file: 'a.txt', step })
        return { diagrams: count, boundary }
      } finally {
        await page.evaluate(
          (selector) => document.querySelector(selector)?.remove(),
          mermaidSelectors.styleFixture,
        )
        await openFixtureWorkspace(page, checkoutRoot)
      }
    },
  })
}

function copyDiagrams(host: Element, count: number) {
  const source = host.shadowRoot ?? host
  const svg = source.querySelector('svg')
  if (!svg) return null
  const copies = document.createElement('aside')
  copies.setAttribute('data-mermaid-style-fixture', '')
  copies.style.position = 'absolute'
  copies.style.left = '-10000px'
  copies.style.width = '720px'
  for (let index = 0; index < count; index += 1) {
    const target = document.createElement('div')
    const scope = host.shadowRoot ? target.attachShadow({ mode: 'open' }) : target
    if (scope instanceof ShadowRoot) scope.adoptedStyleSheets = host.shadowRoot!.adoptedStyleSheets
    scope.innerHTML = svg.outerHTML.replaceAll(svg.id, `mermaid-style-fixture-${index}`)
    copies.append(target)
  }
  document.body.append(copies)
  return host.shadowRoot ? 'shadow' : 'light'
}
