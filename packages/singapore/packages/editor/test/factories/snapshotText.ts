import { createStringTextSnapshot, type TextReadSnapshot } from '../../src/documentTextSnapshot'
import type { EditorViewSnapshot } from '../../src/plugins'
import { LineStartsView } from '../../src/virtualization/lineStartIndex'

/** The text fields a hand-built view snapshot needs: the read source and its line view. */
export function snapshotText(
  text: string,
): Pick<EditorViewSnapshot, 'textSnapshot' | 'lineStartsView'> {
  const textSnapshot = createStringTextSnapshot(text)
  return { textSnapshot, lineStartsView: new LineStartsView(textSnapshot) }
}

/** The whole source as one string, for assertions about document content. */
export function readAll(source: TextReadSnapshot): string {
  return source.readRange(0, source.length)
}
