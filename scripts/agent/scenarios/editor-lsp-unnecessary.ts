import type { Scenario } from './index'
import { runDiagnosticTagScenario } from './editor-diagnostic-tags'

export const editorLspUnnecessary: Scenario = {
  name: 'editor-lsp-unnecessary',
  description: 'Unused code fades in its syntax color using the theme opacity.',
  run: (page, context) => runDiagnosticTagScenario(page, context, 'fade'),
}
