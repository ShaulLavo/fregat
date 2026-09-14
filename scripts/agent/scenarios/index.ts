import type { Page } from 'playwright'

export type ScenarioContext = {
  readonly file: string
  readonly step: (label: string) => Promise<void>
}

export type Scenario = {
  readonly name: string
  readonly description: string
  readonly run: (page: Page, context: ScenarioContext) => Promise<void>
}

import { editorFastScroll } from './editor-fast-scroll'
import { editorLargePaste } from './editor-large-paste'
import { editorTypeBurst } from './editor-type-burst'
import { editorCaretBurst } from './editor-caret-burst'

export const scenarios: readonly Scenario[] = [
  editorLargePaste,
  editorFastScroll,
  editorTypeBurst,
  editorCaretBurst,
]

export function scenarioNamed(name: string): Scenario {
  const scenario = scenarios.find((entry) => entry.name === name)
  if (scenario) return scenario
  const names = scenarios.map((entry) => entry.name).join(', ')
  throw new Error(`Unknown scenario "${name}". Known: ${names}`)
}
