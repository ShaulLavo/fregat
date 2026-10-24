import {
  anchorAfter,
  createPieceTableSnapshot,
  deleteFromPieceTable,
  insertIntoPieceTable,
  materializePieceTableFullText as text,
  resolveAnchor,
} from '@singapore-editor/textbuffer'

// Every edit returns a new version. Old versions stay readable.
const first = createPieceTableSnapshot('hello')
const second = insertIntoPieceTable(first, 5, ' world')
const branch = insertIntoPieceTable(first, 0, 'say ')

text(first) // 'hello'
text(second) // 'hello world'
text(branch) // 'say hello'

// An anchor follows its text through later edits.
const world = anchorAfter(second, 6)
const third = deleteFromPieceTable(second, 0, 6)
resolveAnchor(third, world) // { offset: 0, liveness: 'live' }
