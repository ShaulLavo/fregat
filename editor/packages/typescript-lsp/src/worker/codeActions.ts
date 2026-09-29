import ts from 'typescript'
import type * as lsp from 'vscode-languageserver-protocol'
import type { DocumentContext, ServiceContext } from './context'
import { workspaceEdit } from './edits'
import { isRecord, rangeParam } from './protocol'

const QUICK_FIX = 'quickfix'
const REFACTOR = 'refactor'
const SOURCE = 'source'
const ORGANIZE_IMPORTS = 'source.organizeImports'
const CODE_ACTION_TRIGGER_AUTOMATIC = 2

/**
 * VS Code's ranking of TypeScript fixes: a fix named here is preferred unless another offered fix
 * outranks it, and an import is preferred only when it is the one import on offer.
 */
const PREFERRED_FIXES = new Map<string, { readonly priority: number; readonly onlyOne?: boolean }>([
  ['annotateWithTypeFromJSDoc', { priority: 2 }],
  ['constructorForDerivedNeedSuperCall', { priority: 2 }],
  ['extendsInterfaceBecomesImplements', { priority: 2 }],
  ['fixAwaitInSyncFunction', { priority: 2 }],
  ['removeUnnecessaryAwait', { priority: 2 }],
  ['fixClassIncorrectlyImplementsInterface', { priority: 3 }],
  ['fixClassDoesntImplementInheritedAbstractMember', { priority: 3 }],
  ['fixUnreachableCode', { priority: 2 }],
  ['unusedIdentifier', { priority: 2 }],
  ['forgottenThisPropertyAccess', { priority: 2 }],
  ['spelling', { priority: 0 }],
  ['addMissingAwait', { priority: 2 }],
  ['fixOverrideModifier', { priority: 2 }],
  ['addMissingNewOperator', { priority: 2 }],
  ['import', { priority: 1, onlyOne: true }],
])

/** A refactor is offered as a handle; resolve turns it into edits only once it is chosen. */
type RefactorData = {
  readonly uri: lsp.DocumentUri
  readonly start: number
  readonly end: number
  readonly refactor: string
  readonly action: string
}

type OfferedFix = {
  readonly fix: ts.CodeFixAction
  readonly diagnostic: lsp.Diagnostic
}

let supportedFixCodes: ReadonlySet<string> | null = null

export function codeActions(ctx: DocumentContext, params: unknown): lsp.CodeAction[] {
  const range = rangeParam(params)
  if (!range) return []

  const context = isRecord(params) && isRecord(params.context) ? params.context : {}
  const only = Array.isArray(context.only) ? (context.only as string[]) : null
  const actions: lsp.CodeAction[] = []
  if (overlaps(only, QUICK_FIX)) actions.push(...quickFixes(ctx, diagnosticsOf(context)))
  if (ctx.cancelled()) return actions
  if (overlaps(only, REFACTOR) && context.triggerKind !== CODE_ACTION_TRIGGER_AUTOMATIC) {
    actions.push(...refactors(ctx, range, only))
  }
  if (asksFor(only, ORGANIZE_IMPORTS)) actions.push(organizeImports(ctx))
  return actions
}

export function resolveCodeAction(ctx: ServiceContext, params: unknown): lsp.CodeAction {
  const action = params as lsp.CodeAction
  const data = refactorData(action.data)
  if (!data) return action

  const fileName = ctx.fileNameOf(data.uri)
  if (!fileName) return action

  const edits = ctx.env.languageService.getEditsForRefactor(
    fileName,
    ctx.formatSettings,
    { pos: data.start, end: data.end },
    data.refactor,
    data.action,
    ctx.preferences,
  )
  if (!edits) return action

  return { ...action, edit: workspaceEdit(ctx, edits.edits) }
}

function quickFixes(
  ctx: DocumentContext,
  diagnostics: readonly lsp.Diagnostic[],
): lsp.CodeAction[] {
  const offered: OfferedFix[] = []
  const seen = new Set<string>()
  for (const diagnostic of diagnostics) {
    const code = String(diagnostic.code ?? '')
    if (!fixCodes().has(code)) continue

    const fixes = ctx.env.languageService.getCodeFixesAtPosition(
      ctx.document.fileName,
      ctx.lines.offset(diagnostic.range.start),
      ctx.lines.offset(diagnostic.range.end),
      [Number(code)],
      ctx.formatSettings,
      ctx.preferences,
    )
    for (const fix of fixes) {
      if (fix.commands?.length || seen.has(fix.description)) continue
      seen.add(fix.description)
      offered.push({ fix, diagnostic })
    }
  }

  return offered.map((entry) => ({
    title: entry.fix.description,
    kind: QUICK_FIX,
    diagnostics: [entry.diagnostic],
    isPreferred: isPreferredFix(entry.fix, offered),
    edit: workspaceEdit(ctx, entry.fix.changes),
  }))
}

function isPreferredFix(fix: ts.CodeFixAction, offered: readonly OfferedFix[]): boolean {
  const rank = PREFERRED_FIXES.get(fix.fixName)
  if (!rank) return false

  return offered.every(({ fix: other }) => {
    if (other === fix) return true
    const otherRank = PREFERRED_FIXES.get(other.fixName)
    if (!otherRank || otherRank.priority < rank.priority) return true
    if (otherRank.priority > rank.priority) return false
    return !(rank.onlyOne && other.fixName === fix.fixName)
  })
}

function refactors(
  ctx: DocumentContext,
  range: lsp.Range,
  only: readonly string[] | null,
): lsp.CodeAction[] {
  const start = ctx.lines.offset(range.start)
  const end = ctx.lines.offset(range.end)
  const applicable = ctx.env.languageService.getApplicableRefactors(
    ctx.document.fileName,
    { pos: start, end },
    ctx.preferences,
    'invoked',
    undefined,
    false,
  )

  return applicable.flatMap((refactor) =>
    refactor.actions.flatMap((action) => {
      if (action.notApplicableReason || action.isInteractive) return []

      const kind = action.kind ?? REFACTOR
      if (!wants(only, kind)) return []

      const data: RefactorData = {
        uri: ctx.document.uri,
        start,
        end,
        refactor: refactor.name,
        action: action.name,
      }
      return [{ title: action.description, kind, data }]
    }),
  )
}

function organizeImports(ctx: DocumentContext): lsp.CodeAction {
  const changes = ctx.env.languageService.organizeImports(
    { type: 'file', fileName: ctx.document.fileName },
    ctx.formatSettings,
    ctx.preferences,
  )
  return { title: 'Organize Imports', kind: ORGANIZE_IMPORTS, edit: workspaceEdit(ctx, changes) }
}

/** No `only` means every kind except source actions, which a client has to ask for by name. */
function wants(only: readonly string[] | null, kind: string): boolean {
  if (!only || only.length === 0) return !kindMatches(SOURCE, kind)
  return only.some((requested) => kindMatches(requested, kind))
}

/** Whether any kind asked for sits above or below `family`, so some action in it may qualify. */
function overlaps(only: readonly string[] | null, family: string): boolean {
  if (!only || only.length === 0) return true
  return only.some((requested) => kindMatches(requested, family) || kindMatches(family, requested))
}

function asksFor(only: readonly string[] | null, kind: string): boolean {
  if (!only) return false
  return only.some((requested) => kindMatches(requested, kind))
}

function kindMatches(requested: string, kind: string): boolean {
  if (requested === '') return true
  return kind === requested || kind.startsWith(`${requested}.`)
}

function diagnosticsOf(context: Record<string, unknown>): readonly lsp.Diagnostic[] {
  return Array.isArray(context.diagnostics) ? (context.diagnostics as lsp.Diagnostic[]) : []
}

function fixCodes(): ReadonlySet<string> {
  supportedFixCodes ??= new Set(ts.getSupportedCodeFixes())
  return supportedFixCodes
}

function refactorData(value: unknown): RefactorData | null {
  if (!isRecord(value)) return null
  if (typeof value.uri !== 'string') return null
  if (typeof value.start !== 'number' || typeof value.end !== 'number') return null
  if (typeof value.refactor !== 'string' || typeof value.action !== 'string') return null
  return value as RefactorData
}
