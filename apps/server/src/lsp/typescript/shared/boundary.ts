import { fileUriForPath } from '@workspace/contracts'
import { lineStartOffset } from '@workspace/utils/strings'
import { samePath } from '../../../utils/path'
import { normalizeNativePath } from '../../../utils/path'
import { isInsidePath } from '../../../utils/path'
import path from 'node:path'

import { isRecord } from '@workspace/utils/objects'
import ts from 'typescript-language-service'
import type * as lsp from 'vscode-languageserver-protocol'

import type { SessionContext } from './context'

export type TextDocumentPositionRequest = {
  uri: lsp.DocumentUri
  fileName: string
  position: lsp.Position
}

export function textDocumentPosition(
  ctx: SessionContext,
  params: unknown,
): TextDocumentPositionRequest | null {
  const request = textDocumentPositionParams(params)
  if (!request) return null

  const fileName = fileNameForUri(ctx, request.uri)
  if (!fileName) return null

  return { ...request, fileName }
}

export function textDocumentPositionParams(params: unknown): {
  uri: lsp.DocumentUri
  position: lsp.Position
} | null {
  if (!isRecord(params)) return null
  if (!isRecord(params.textDocument)) return null
  if (!isRecord(params.position)) return null
  if (typeof params.textDocument.uri !== 'string') return null
  if (typeof params.position.line !== 'number') return null
  if (typeof params.position.character !== 'number') return null

  return {
    uri: params.textDocument.uri,
    position: {
      line: params.position.line,
      character: params.position.character,
    },
  }
}

export function documentText(ctx: SessionContext, fileName: string): string | null {
  return documentTextSnapshot(ctx, fileName)?.text ?? null
}

export type DocumentTextSnapshot = {
  readonly text: string
  readonly version: number | null
}

export function documentTextSnapshot(
  ctx: SessionContext,
  fileName: string,
): DocumentTextSnapshot | null {
  const normalized = normalizeNativePath(fileName)
  const document = openDocumentForFileName(ctx, normalized)
  if (document) return { text: document.text, version: document.version }
  if (!canReadFile(ctx, normalized)) return null

  try {
    const text = ts.sys.readFile(normalized)
    return text === undefined ? null : { text, version: null }
  } catch {
    return null
  }
}

export function fileNameForUri(ctx: SessionContext, uri: lsp.DocumentUri): string | null {
  const fileName = documentUriToFileName(uri)
  if (fileName && isInsidePath(ctx.root, fileName)) return fileName

  const workspaceFileName = documentUriToWorkspaceFileName(ctx.workspaceRoot, uri)
  if (!workspaceFileName) return null
  if (!isInsidePath(ctx.root, workspaceFileName)) return null
  return workspaceFileName
}

export function documentUriForFileName(ctx: SessionContext, fileName: string): lsp.DocumentUri {
  const normalized = normalizeNativePath(fileName)
  if (!isInsidePath(ctx.workspaceRoot, normalized)) return fileNameToDocumentUri(normalized)

  const relativePath = path.relative(ctx.workspaceRoot, normalized)
  return fileUriForPath(relativePath)
}

export function rangeFromTextSpan(text: string, span: ts.TextSpan): lsp.Range {
  const start = clampOffset(span.start, text)
  const end = clampOffset(span.start + span.length, text)
  return {
    start: offsetToLspPosition(text, start),
    end: offsetToLspPosition(text, end),
  }
}

export function strictRangeFromTextSpan(text: string, span: ts.TextSpan): lsp.Range | null {
  if (!Number.isSafeInteger(span.start)) return null
  if (!Number.isSafeInteger(span.length)) return null
  if (span.start < 0 || span.length < 0) return null
  if (span.start > text.length) return null
  if (span.length > text.length - span.start) return null

  return {
    start: offsetToLspPosition(text, span.start),
    end: offsetToLspPosition(text, span.start + span.length),
  }
}

export function lspPositionToOffset(text: string, position: lsp.Position): number {
  const lineStart = lineStartOffset(text, position.line)
  if (lineStart === null) return text.length
  return clampOffset(lineStart + position.character, text)
}

function canReadFile(ctx: SessionContext, fileName: string): boolean {
  if (isInsidePath(ctx.root, fileName)) return true
  if (isInsidePath(ctx.workspaceRoot, fileName)) return true
  return isInsidePath(typeScriptLibDirectory(), fileName)
}

function openDocumentForFileName(ctx: SessionContext, fileName: string) {
  for (const document of ctx.documents.values()) {
    if (samePath(document.fileName, fileName)) return document
  }

  return null
}

function documentUriToFileName(uri: string): string | null {
  try {
    const url = new URL(uri)
    if (url.protocol !== 'file:') return null
    return normalizeNativePath(decodeURIComponent(url.pathname))
  } catch {
    return null
  }
}

function documentUriToWorkspaceFileName(workspaceRoot: string, uri: string): string | null {
  try {
    const url = new URL(uri)
    if (url.protocol !== 'file:') return null

    const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    if (relativePath === '') return normalizeNativePath(workspaceRoot)
    return normalizeNativePath(path.join(workspaceRoot, relativePath))
  } catch {
    return null
  }
}

// A relative file name resolves against the process cwd; the shared `fileUriForPath` never resolves.
function fileNameToDocumentUri(fileName: string): lsp.DocumentUri {
  const normalized = normalizeNativePath(fileName)
  return `file://${normalized.split('/').map(encodePathPart).join('/')}`
}

function encodePathPart(part: string, index: number): string {
  if (index === 0 && part === '') return ''
  return encodeURIComponent(part)
}

function offsetToLspPosition(text: string, offset: number): lsp.Position {
  const clamped = clampOffset(offset, text)
  let line = 0
  let lineStart = 0

  for (let index = 0; index < clamped; index += 1) {
    if (text[index] !== '\n') continue
    line += 1
    lineStart = index + 1
  }

  return { line, character: clamped - lineStart }
}

function clampOffset(offset: number, text: string): number {
  return Math.min(text.length, Math.max(0, offset))
}

function typeScriptLibDirectory(): string {
  return normalizeNativePath(path.dirname(ts.getDefaultLibFilePath({})))
}

export function locationForTextSpan(
  ctx: SessionContext,
  fileName: string,
  span: ts.TextSpan,
): readonly lsp.Location[] {
  const normalized = normalizeNativePath(fileName)
  if (!isInsidePath(ctx.root, normalized)) return []

  const text = documentText(ctx, normalized)
  if (text === null) return []

  return [
    {
      uri: documentUriForFileName(ctx, normalized),
      range: rangeFromTextSpan(text, span),
    },
  ]
}

export function textDocumentIdentifier(params: unknown): lsp.TextDocumentIdentifier | null {
  if (!isRecord(params)) return null
  if (!isRecord(params.textDocument)) return null
  return typeof params.textDocument.uri === 'string'
    ? ({ uri: params.textDocument.uri } satisfies lsp.TextDocumentIdentifier)
    : null
}
