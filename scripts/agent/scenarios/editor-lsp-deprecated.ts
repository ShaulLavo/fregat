import type { Scenario } from './index'
import { runDiagnosticTagScenario } from './editor-diagnostic-tags'

export const editorLspDeprecated: Scenario = {
  name: 'editor-lsp-deprecated',
  description: 'Deprecated code is struck through in its syntax color.',
  run: (page, context) => runDiagnosticTagScenario(page, context, 'strike'),
}
