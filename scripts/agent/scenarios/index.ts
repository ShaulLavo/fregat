import type { Page } from 'playwright'

export type ScenarioContext = {
  readonly file: string
  readonly step: (label: string) => Promise<void>
}

export type Scenario = {
  readonly surface?: 'site' | 'demo'
  readonly name: string
  readonly description: string
  readonly run: (page: Page, context: ScenarioContext) => Promise<void>
  readonly inspect?: (page: Page) => Promise<unknown>
}

import { editorFastScroll } from './editor-fast-scroll'
import { editorLargePaste } from './editor-large-paste'
import { editorTypeBurst } from './editor-type-burst'
import { gitHistory } from './git-history'
import { editorCaretBurst } from './editor-caret-burst'
import { editorFocusClicks } from './editor-focus-clicks'
import { editorProduct } from './editor-product'
import { treeStickyScroll } from './tree-sticky-scroll'
import { demoWorkspace } from './demo-workspace'
import { demoAgentGit } from './demo-agent-git'
import { demoReset } from './demo-reset'
import { demoStartup } from './demo-startup'
import { demoThemeStartup } from './demo-theme-startup'

export const scenarios: readonly Scenario[] = [
  demoWorkspace,
  demoAgentGit,
  demoReset,
  demoStartup,
  demoThemeStartup,
  gitHistory,
  editorLargePaste,
  editorFastScroll,
  editorTypeBurst,
  editorCaretBurst,
  editorFocusClicks,
  editorProduct,
  treeStickyScroll,
]

export function scenarioNamed(name: string): Scenario {
  const scenario = scenarios.find((entry) => entry.name === name)
  if (scenario) return scenario
  const names = scenarios.map((entry) => entry.name).join(', ')
  throw new Error(`Unknown scenario "${name}". Known: ${names}`)
}
