import { BookBookmarkIcon, BookOpenIcon } from '@phosphor-icons/react'

import { actionItem, section, type MenuSection } from '@/keymap/menus/utils/model'

type SpellingMenuOptions = {
  readonly word: string
  /** Null while the suggestions are being looked up. */
  readonly suggestions: readonly string[] | null
  readonly hasWorkspace: boolean
  readonly replace: (suggestion: string) => void
  readonly accept: (target: 'user' | 'workspace') => void
}

/** The section a right-click on a marked word leads with: replacements, then the dictionaries. */
export function spellingMenuSection(options: SpellingMenuOptions): MenuSection {
  const { word } = options
  const dictionaries = [
    actionItem({
      id: 'spelling.addToDictionary',
      icon: BookOpenIcon,
      label: 'Add to Dictionary',
      run: () => options.accept('user'),
    }),
    ...(options.hasWorkspace
      ? [
          actionItem({
            id: 'spelling.addToWorkspaceDictionary',
            icon: BookBookmarkIcon,
            label: 'Add to Workspace Dictionary',
            run: () => options.accept('workspace'),
          }),
        ]
      : []),
  ]
  return section('spelling', [...suggestionItems(word, options), ...dictionaries])
}

function suggestionItems(word: string, options: SpellingMenuOptions) {
  const { suggestions } = options
  if (!suggestions) {
    return [
      actionItem({
        id: 'spelling.pending',
        label: 'Finding suggestions…',
        disabled: true,
        run: noop,
      }),
    ]
  }
  if (suggestions.length === 0) {
    return [
      actionItem({
        id: 'spelling.none',
        label: `No suggestions for “${word}”`,
        disabled: true,
        run: noop,
      }),
    ]
  }
  return suggestions.map((suggestion) =>
    actionItem({
      id: `spelling.replace.${suggestion}`,
      label: suggestion,
      run: () => options.replace(suggestion),
    }),
  )
}

function noop() {}
