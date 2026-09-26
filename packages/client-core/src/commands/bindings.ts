import { keysConflict } from './chord'
import type { FocusArea } from './focus'

type ScopedBinding = { readonly pane?: FocusArea | 'any'; readonly keys: string }

export function bindingsCollide(left: ScopedBinding, right: ScopedBinding) {
  return (left.pane ?? 'any') === (right.pane ?? 'any') && keysConflict(left.keys, right.keys)
}

export function activeBindings<T extends ScopedBinding>(
  bindings: readonly T[],
  area: FocusArea,
): readonly T[] {
  return bindings
    .filter((binding) => !binding.pane || binding.pane === 'any' || binding.pane === area)
    .toSorted((left, right) => Number(right.pane === area) - Number(left.pane === area))
}

export function defaultBindingPane(
  target: string | undefined,
  authoredPane?: FocusArea | 'any',
): FocusArea | 'any' {
  if (authoredPane) return authoredPane
  return target === 'editor' ? 'editor' : 'any'
}
