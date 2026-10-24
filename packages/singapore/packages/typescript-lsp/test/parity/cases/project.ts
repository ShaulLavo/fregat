import { offsetToLspPosition } from '@singapore-editor/lsp'
import type * as lsp from 'vscode-languageserver-protocol'
import type { ParitySession } from '../contract'

const shapes = `export interface Shape {
  area(): number
}

/** A circle, measured by its radius. */
export class Circle implements Shape {
  constructor(readonly radius: number) {}

  area(): number {
    return Math.PI * this.radius ** 2
  }
}

export function describe(shape: Shape, label: string): string {
  return \`\${label}: \${shape.area()}\`
}
`

const main = `import { Circle, describe } from './shapes'

const circle = new Circle(2)
const total: number = describe(circle, 'circle')
const   spaced   =   1
console.log(total, spaced, circl)
`

const unsavedDiagnosticMarker = '__parityMissingAfterEdit'
const editText = `const afterEdit = ${unsavedDiagnosticMarker};
const   packed   =   3;
circle.ar`

export const CORE_PROJECT = {
  id: 'core-useful-answers',
  unsavedDiagnosticMarker,
  mainPath: 'src/main.ts',
  shapesPath: 'src/shapes.ts',
  files: [
    { path: 'src/shapes.ts', text: shapes, languageId: 'typescript' },
    { path: 'src/main.ts', text: main, languageId: 'typescript' },
  ],
  shapesText: shapes,
  mainText: main,
  editText,
  editedMainText: main + editText,
}

export async function openAndEditCoreProject(session: ParitySession): Promise<void> {
  for (const file of CORE_PROJECT.files) {
    await session.client.notify('textDocument/didOpen', {
      textDocument: {
        uri: session.uri(file.path),
        languageId: file.languageId,
        version: 1,
        text: file.text,
      },
    })
  }
  const uri = session.uri(CORE_PROJECT.mainPath)
  const end = offsetToLspPosition(main, main.length)
  await session.client.notify('textDocument/didChange', {
    textDocument: { uri, version: 2 },
    contentChanges: [{ range: { start: end, end }, text: editText }],
  })
}

export function positionOf(text: string, marker: string, delta = 0): lsp.Position {
  const offset = text.indexOf(marker)
  if (offset < 0) throw new TypeError(`Fixture has no "${marker}"`)
  return offsetToLspPosition(text, offset + delta)
}

export function positionIn(uri: string, position: lsp.Position): lsp.TextDocumentPositionParams {
  return { textDocument: { uri }, position }
}
