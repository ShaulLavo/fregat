import type { EditorTheme } from '../theme'
import type { EditorHighlighterProvider } from './highlighter'

type ThemeProviderIdentity = {
  readonly provider: EditorHighlighterProvider
  readonly loadTheme: EditorHighlighterProvider['loadTheme']
}
export type ThemeCohort = readonly ThemeProviderIdentity[]

export function captureThemeCohort(providers: readonly EditorHighlighterProvider[]): ThemeCohort {
  return providers.map((provider) => ({ provider, loadTheme: provider.loadTheme }))
}

export function sameThemeCohort(left: ThemeCohort, right: ThemeCohort): boolean {
  return (
    left.length === right.length &&
    left.every(
      (item, index) =>
        item.provider === right[index]?.provider && item.loadTheme === right[index]?.loadTheme,
    )
  )
}

export function themeCohortIsCurrent(cohort: ThemeCohort): boolean {
  return cohort.every((item) => item.loadTheme === item.provider.loadTheme)
}

function checkThemeCohort(cohort: ThemeCohort, signal?: AbortSignal): void {
  signal?.throwIfAborted()
  if (!themeCohortIsCurrent(cohort)) AbortSignal.abort().throwIfAborted()
}

export async function loadOrderedHighlighterTheme(
  cohort: ThemeCohort,
  signal?: AbortSignal,
): Promise<EditorTheme | null | undefined> {
  await Promise.resolve()
  checkThemeCohort(cohort, signal)
  for (const item of cohort) {
    checkThemeCohort(cohort, signal)
    if (!item.loadTheme) continue
    const theme = await item.loadTheme.call(item.provider)
    checkThemeCohort(cohort, signal)
    if (theme !== undefined) return theme
  }
  return undefined
}
