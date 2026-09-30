export type EditorFindOptions = {
  readonly loop?: boolean
  readonly seedSearchStringFromSelection?: 'never' | 'always' | 'selection'
  readonly findOnType?: boolean
  readonly cursorMoveOnType?: boolean
  readonly autoFindInSelection?: 'never' | 'always' | 'multiline'
}
