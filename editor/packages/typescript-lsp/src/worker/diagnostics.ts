import type * as lsp from 'vscode-languageserver-protocol'
import { tsDiagnosticToLspDiagnostic } from '../tsDiagnostics'
import type { DocumentContext } from './context'
import type { ProjectService } from './projectHost'
import { stringParam } from './protocol'

export function collectDiagnostics(env: ProjectService, fileName: string): lsp.Diagnostic[] {
  const service = env.languageService
  return [
    ...service.getSyntacticDiagnostics(fileName),
    ...service.getSemanticDiagnostics(fileName),
    ...service.getSuggestionDiagnostics(fileName),
  ].map((diagnostic) => tsDiagnosticToLspDiagnostic(diagnostic))
}

/**
 * A pull report. `resultId` names the project revision the items were computed from: any file
 * changing can change another file's diagnostics, so an unchanged revision is the only proof that
 * the client's last report still holds.
 */
export function documentDiagnosticReport(
  ctx: DocumentContext,
  params: unknown,
  projectRevision: number,
): lsp.DocumentDiagnosticReport {
  const resultId = String(projectRevision)
  if (stringParam(params, 'previousResultId') === resultId) return { kind: 'unchanged', resultId }

  return { kind: 'full', resultId, items: collectDiagnostics(ctx.env, ctx.document.fileName) }
}
