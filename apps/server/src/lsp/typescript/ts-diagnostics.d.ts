declare module '@singapore-editor/typescript-lsp/ts-diagnostics' {
  import ts from 'typescript-language-service'
  import type * as lsp from 'vscode-languageserver-protocol'

  export function tsDiagnosticMessageText(diagnostic: ts.Diagnostic): string

  export function tsDiagnosticToLspDiagnostic(
    diagnostic: ts.Diagnostic,
    text?: string,
  ): lsp.Diagnostic
}
