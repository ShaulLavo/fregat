import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'
import { createScriptError } from '../../structured-errors'
import { openFixtureWorkspace } from '../fixture-workspace'
import { writeUserOperations } from '../preserve-settings'
import { selectors } from '../selectors'
import { createTreeParityFixture } from '../tree-parity/fixture'
import { pixelDiff } from '../tree-parity/pixel-diff'
import { diffProbes, probeTree } from '../tree-parity/probe'
import {
  filterInput,
  heldRequests,
  PARITY_STATES,
  treeRow,
  type ParityState,
  type StateContext,
} from '../tree-parity/states'
import type { Scenario } from './index'

type Combo = { readonly density: 'compact' | 'cozy'; readonly mode: 'light' | 'dark' }

const COMBOS: readonly Combo[] = [
  { density: 'compact', mode: 'light' },
  { density: 'compact', mode: 'dark' },
  { density: 'cozy', mode: 'light' },
  { density: 'cozy', mode: 'dark' },
]
const ROW_HEIGHT = { compact: 20, cozy: 24 } as const
/** Captures stop here: below it the fixture has only empty pane. */
const CLIP_HEIGHT = 640
const TREE_PARITY_BASELINE = path.join(import.meta.dirname, '../baselines/tree-parity')

type StateResult = {
  readonly state: string
  readonly combo: string
  readonly pixels: { readonly ratio: number; readonly mismatched: number; readonly size?: string }
  readonly styles: readonly string[]
  readonly failed: boolean
}

/**
 * The file tree's parity harness (Plan 178): every state across density × colour mode, diffed
 * pixel by pixel and property by property against the committed baseline. `TREE_PARITY_UPDATE=1`
 * rewrites the baseline instead of comparing; `TREE_PARITY_STATES` limits the run.
 */
export const treeParity: Scenario = {
  name: 'tree-parity',
  description:
    'Capture the file tree in every state across compact/cozy and light/dark and diff it against the committed baseline.',
  capture: { scale: 2, width: 1440, height: 900 },
  async run(page, { evidence }) {
    const update = process.env.TREE_PARITY_UPDATE === '1'
    const fixture = await createTreeParityFixture()
    const held = heldRequests(page)
    try {
      await writeUserOperations(page, [
        { kind: 'set', key: 'workbench.wallpaper', value: WALLPAPER_OFF },
        { kind: 'set', key: 'workbench.tree.indentGuides', value: 'always' },
      ])
      await openFixtureWorkspace(page, fixture.root)
      await expandFixture(page)
      const context: StateContext = { page, held, rest: () => restTree(page) }
      await context.rest()
      const results: StateResult[] = []
      for (const state of selectedStates()) {
        results.push(...(await captureState(page, state, context, evidence.dir, update)))
      }
      await evidence.json('tree-parity.json', { update, results })
      if (update) return
      const failed = results.filter((result) => result.failed)
      if (failed.length === 0) return
      throw createScriptError(
        `Tree parity drift in ${failed.length} capture(s): ${failed
          .map((result) => `${result.state}/${result.combo}`)
          .join(', ')}. Diffs are in ${evidence.dir}/tree-parity/.`,
      )
    } finally {
      await held.release().catch(() => undefined)
      await fixture.release()
    }
  },
}

/** `TREE_PARITY_STATES=rest,hover` limits a run to those states. */
function selectedStates() {
  const names = process.env.TREE_PARITY_STATES?.split(',').filter(Boolean)
  if (!names) return PARITY_STATES
  const unknown = names.filter((name) => !PARITY_STATES.some((state) => state.name === name))
  if (unknown.length > 0)
    throw createScriptError(`Unknown tree parity state(s): ${unknown.join(', ')}.`)
  return PARITY_STATES.filter((state) => names.includes(state.name))
}

const WALLPAPER_OFF = { enabled: false, source: { kind: 'desktop' } }

async function expandFixture(page: Page) {
  for (const file of [
    'src/app.ts',
    'src/components/button.tsx',
    'src/components/deep/nested/leaf.css',
    'lonely/chain/of/single/only.txt',
  ]) {
    await expandTo(page, file)
  }
  await treeRow(page, 'secret/').click()
  await selectors.folderTree(page).getByText('no access').waitFor()
}

/** Expands collapsed ancestors of `file` one at a time: a chain only flattens once it loads. */
async function expandTo(page: Page, file: string) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (await treeRow(page, file).isVisible()) return
    const collapsed = await selectors
      .folderTree(page)
      .locator('[role="treeitem"][aria-expanded="false"]')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-item-path') ?? ''))
    const next = collapsed.find((folder) => folder !== '' && file.startsWith(folder))
    if (next) await treeRow(page, next).click()
    await page.waitForTimeout(250)
  }
  await treeRow(page, file).waitFor({ timeout: 2000 })
}

async function restTree(page: Page) {
  const filter = filterInput(page)
  if ((await filter.inputValue()) !== '') {
    await filter.fill('')
    await filter.press('Escape')
  }
  await treeRow(page, 'src/app.ts').click()
  await selectors.editorInput(page).first().waitFor()
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  const viewport = page.viewportSize()
  await page.mouse.move((viewport?.width ?? 1440) - 20, (viewport?.height ?? 900) / 2)
}

async function captureState(
  page: Page,
  state: ParityState,
  context: StateContext,
  evidenceDir: string,
  update: boolean,
) {
  const results: StateResult[] = []
  await state.enter(context)
  try {
    for (const combo of COMBOS) {
      await applyCombo(page, combo)
      results.push(await captureCombo(page, state, combo, evidenceDir, update))
    }
  } finally {
    await state.leave?.(context)
    await applyCombo(page, COMBOS[0]!)
    await context.rest()
  }
  return results
}

async function applyCombo(page: Page, combo: Combo) {
  await writeUserOperations(page, [
    { kind: 'set', key: 'workbench.density', value: combo.density },
    { kind: 'set', key: 'workbench.colorTheme', value: combo.mode },
  ])
  await page.waitForFunction(
    ({ density, mode, height }) => {
      const root = document.documentElement
      if (root.getAttribute('data-density') !== density) return false
      if (!root.classList.contains(mode)) return false
      const host = document.querySelector<HTMLElement>('[aria-label="Folder tree"]')
      const row = (host?.shadowRoot ?? host)?.querySelector('[role="treeitem"]')
      return row?.getBoundingClientRect().height === height
    },
    { ...combo, height: ROW_HEIGHT[combo.density] },
  )
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
  // Colour transitions on the theme switch and the 150ms guide fade settle inside this.
  await page.waitForTimeout(300)
}

async function captureCombo(
  page: Page,
  state: ParityState,
  combo: Combo,
  evidenceDir: string,
  update: boolean,
): Promise<StateResult> {
  const label = `${combo.density}-${combo.mode}`
  const tree = await selectors.folderTree(page).boundingBox()
  if (!tree) throw createScriptError('The folder tree is not on screen.')
  const png = await page.screenshot({
    animations: 'disabled',
    caret: 'hide',
    clip: { x: tree.x, y: tree.y, width: tree.width, height: Math.min(tree.height, CLIP_HEIGHT) },
  })
  const probe = await page.evaluate(probeTree)
  const baselineDir = path.join(TREE_PARITY_BASELINE, state.name)
  const outDir = path.join(evidenceDir, 'tree-parity', state.name)
  await mkdir(outDir, { recursive: true })
  await writeFile(path.join(outDir, `${label}.png`), png)
  await writeFile(path.join(outDir, `${label}.json`), `${JSON.stringify(probe, null, 2)}\n`)
  if (update) {
    await mkdir(baselineDir, { recursive: true })
    await writeFile(path.join(baselineDir, `${label}.png`), png)
    await writeFile(path.join(baselineDir, `${label}.json.gz`), Bun.gzipSync(JSON.stringify(probe)))
    return {
      state: state.name,
      combo: label,
      pixels: { ratio: 0, mismatched: 0 },
      styles: [],
      failed: false,
    }
  }
  const baselinePng = path.join(baselineDir, `${label}.png`)
  if (!existsSync(baselinePng))
    throw createScriptError(
      `No tree parity baseline for ${state.name}/${label}; run with TREE_PARITY_UPDATE=1 first.`,
    )
  const pixels = await pixelDiff(page.context(), await readFile(baselinePng), png)
  const baselineProbe = JSON.parse(
    new TextDecoder().decode(
      Bun.gunzipSync(await readFile(path.join(baselineDir, `${label}.json.gz`))),
    ),
  ) as Record<string, string>
  const styles = diffProbes(baselineProbe, probe)
  const failed =
    pixels.sizeMismatch !== null || pixels.ratio > (state.maxRatio ?? 0) || styles.length > 0
  if (failed) {
    await writeFile(path.join(outDir, `${label}.diff.png`), pixels.image)
    await writeFile(path.join(outDir, `${label}.styles.txt`), `${styles.join('\n')}\n`)
  }
  return {
    state: state.name,
    combo: label,
    pixels: {
      ratio: pixels.ratio,
      mismatched: pixels.mismatched,
      ...(pixels.sizeMismatch ? { size: pixels.sizeMismatch } : {}),
    },
    styles,
    failed,
  }
}
