// Modified for Platform from Pierre. Apache-2.0; see packages/tree/LICENSE-pierre and UPSTREAM.md.
// Pure state classifier for the rename handoff effect. The effect has four
// distinct responses it can take — reset tracking state, reveal the canonical
// row if only a sticky mirror is rendered, focus the rendered input, or leave
// things alone because the input already owns focus. Isolating that decision
// here lets the effect become a `switch` and keeps the transitions testable
// without rendering a tree.
export type TreeRenameHandoffAction = 'reset' | 'reveal-canonical' | 'focus-input' | 'ignore'

export type TreeRenameHandoffInput = {
  renamingPath: string | null
  previousRenamingPath: string | null
  hasRenderedInput: boolean
}

export function classifyTreeRenameHandoff(input: TreeRenameHandoffInput): TreeRenameHandoffAction {
  const { renamingPath, previousRenamingPath, hasRenderedInput } = input

  if (renamingPath == null) {
    return 'reset'
  }

  if (!hasRenderedInput) {
    return 'reveal-canonical'
  }

  if (previousRenamingPath === renamingPath) {
    return 'ignore'
  }

  return 'focus-input'
}
