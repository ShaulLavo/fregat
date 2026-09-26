import type { LanguageServerDiagnosticActions } from '@singapore-editor/lsp-plugin'
import { diagnosticMessageText, diagnosticTargetForUri } from '@/lib/diagnostic'
import type { DiagnosticFixRequest } from '@/lib/diagnostic-ai/utils/prompt'

export function diagnosticHoverActions(
  request: (request: DiagnosticFixRequest) => Promise<unknown>,
): LanguageServerDiagnosticActions {
  return ({ documentUri, diagnostic }) => {
    const target = diagnosticTargetForUri(documentUri, diagnostic.range)
    if (!target) return []
    return [
      {
        label: 'Fix with AI',
        run: async () => {
          await request({
            path: target.path,
            range: diagnostic.range,
            message: diagnosticMessageText(diagnostic.message),
            severity: diagnostic.severity,
            code: diagnostic.code === undefined ? null : String(diagnostic.code),
            source: diagnostic.source ?? null,
            surface: 'hover',
          })
        },
      },
    ]
  }
}
