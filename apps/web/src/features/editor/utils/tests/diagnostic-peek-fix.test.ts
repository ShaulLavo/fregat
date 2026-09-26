import { createEditorTextBuffer } from '@singapore-editor/core/document'
import { expect, test } from '../../../../../test/fixtures'

import type { DiagnosticPeekModel } from '@/features/editor/state/diagnostic-peek-source'
import { peekFixRequest } from '@/features/editor/utils/diagnostic-peek-fix'

test('converts the tracked offsets to the line and column they sit at now', () => {
  const text = createEditorTextBuffer('const a = 1\nconst b: string = 2\n').getTextSnapshot()
  const model: DiagnosticPeekModel = {
    code: '2322',
    direction: 'next',
    documentUri: 'file:///repo/src/b.ts',
    geometry: { kind: 'hidden', range: { start: 18, end: 19 } },
    message: "Type 'number' is not assignable to type 'string'.",
    relatedInformation: [],
    severity: 'Error',
    severityLevel: 1,
    source: 'ts',
  }

  expect(peekFixRequest(model, text)).toEqual({
    code: '2322',
    message: "Type 'number' is not assignable to type 'string'.",
    path: 'repo/src/b.ts',
    range: { start: { line: 1, character: 6 }, end: { line: 1, character: 7 } },
    severity: 1,
    source: 'ts',
    surface: 'peek',
  })
})
