export type SpellcheckWorkerRequest =
  | { readonly type: 'check'; readonly id: number; readonly words: readonly string[] }
  | {
      readonly type: 'suggest'
      readonly id: number
      readonly word: string
      readonly limit: number
    }
  | { readonly type: 'setAcceptedWords'; readonly words: readonly string[] }

export type SpellcheckWorkerResponse =
  | { readonly type: 'check'; readonly id: number; readonly misspelled: readonly string[] }
  | { readonly type: 'suggest'; readonly id: number; readonly suggestions: readonly string[] }
  | { readonly type: 'error'; readonly id: number | null; readonly message: string }
