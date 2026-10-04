import { type EditorTextBuffer } from '@singapore-editor/core/document'
import {
  type EditorSyntaxProvider,
  type EditorSyntaxLanguageId,
} from '@singapore-editor/core/syntax'
import { type EditorHighlighterProvider } from '@singapore-editor/core/extensions'
import {
  createEditorPreparedDocument,
  type EditorDocumentAnalysis,
  type EditorPreparedDocument,
  type EditorPreparedTagValue,
} from '@singapore-editor/core/editor'

import { documentAnalysisAllowed } from '@/features/editor/utils/large-file-policy'
import { languageIdForFilePath } from '@/lib/file-language'
import {
  editorHighlighterProvider,
  editorSyntaxColors,
  editorSyntaxProvider,
  type EditorSyntaxColors,
} from '@/features/editor/state/syntax-highlighting'
import type {
  FileOpenIntentPreparationConfiguration,
  FileOpenIntentPreparationStage,
  FileOpenIntentPreparer,
  FileOpenIntentStructuralRange,
} from '@/lib/file-open-intent/state/service'

export type EditorPreparedEnvironment = {
  readonly appliedThemeContentHash: string | null
  readonly appliedThemeId: string | null
  readonly selectedThemeId: string
  readonly analysisLimitMiCodeUnits: number
  readonly syntaxHighlightingEnabled: boolean
  /** Must equal the mounted editor's `tabSize`, or the editor declines the prepared document. */
  readonly tabSize: number
}

export type EditorPreparedDocumentTags = {
  readonly documentConfigurationTag: readonly EditorPreparedTagValue[]
  readonly highlighterConfigurationTag: readonly EditorPreparedTagValue[]
  readonly structuralConfigurationTag: readonly EditorPreparedTagValue[]
}

export function createPlatformFileOpenPreparer(
  environment: EditorPreparedEnvironment,
): FileOpenIntentPreparer {
  const source = environment.syntaxHighlightingEnabled
    ? editorSyntaxColors(environment.selectedThemeId)
    : 'disabled'
  const highlighterProvider = source === 'vscode' ? editorHighlighterProvider() : null
  const structuralProvider = source === 'disabled' ? null : editorSyntaxProvider()
  return {
    environment: {
      configurationTag: preparedEnvironmentConfigurationTag(environment),
      highlighterProvider,
      structuralProvider,
    },
    prepare: (buffer, documentId, path, abortSignal, structuralRange, analysis) => {
      const preparedDocument = prepareEditorDocument(
        buffer,
        documentId,
        path,
        environment,
        analysis,
      )
      return {
        buffer,
        preparedDocument,
        ...preparedDocumentConfiguration(
          preparedDocument,
          buffer,
          path,
          environment,
          abortSignal,
          structuralRange,
          highlighterProvider,
          structuralProvider,
        ),
      }
    },
    reconfigure: (preparedDocument, buffer, _documentId, path, abortSignal, structuralRange) =>
      preparedDocumentConfiguration(
        preparedDocument,
        buffer,
        path,
        environment,
        abortSignal,
        structuralRange,
        highlighterProvider,
        structuralProvider,
      ),
  }
}

export function editorPreparedDocumentTags(
  path: string,
  environment: Omit<EditorPreparedEnvironment, 'tabSize' | 'analysisLimitMiCodeUnits'>,
  analysisAllowed: boolean,
  languageId = languageIdForFilePath(path),
): EditorPreparedDocumentTags {
  const source =
    environment.syntaxHighlightingEnabled && analysisAllowed
      ? editorSyntaxColors(environment.selectedThemeId, languageId)
      : 'disabled'
  const captures = languageId === 'markdown'
  return {
    documentConfigurationTag: ['platform-editor', languageId, source, analysisAllowed],
    highlighterConfigurationTag: [
      'platform-shiki',
      source,
      environment.appliedThemeId,
      environment.appliedThemeContentHash,
      environment.selectedThemeId,
    ],
    structuralConfigurationTag: ['platform-tree-sitter', source, captures],
  }
}

function prepareEditorDocument(
  buffer: EditorTextBuffer,
  documentId: string,
  path: string,
  environment: EditorPreparedEnvironment,
  analysis: EditorDocumentAnalysis,
): EditorPreparedDocument {
  const languageId = languageIdForFilePath(path)
  const analysisAllowed = documentAnalysisAllowed(
    buffer.getSnapshot().length,
    environment.analysisLimitMiCodeUnits,
  )
  const tags = editorPreparedDocumentTags(path, environment, analysisAllowed)
  return createEditorPreparedDocument({
    analysis,
    buffer,
    configuredTabSize: environment.tabSize,
    folding: analysisAllowed,
    tabSizePolicy: analysisAllowed ? 'detect-indentation' : 'fixed',
    documentConfigurationTag: tags.documentConfigurationTag,
    documentId,
    languageId,
  })
}

function preparedDocumentConfiguration(
  prepared: EditorPreparedDocument,
  buffer: EditorTextBuffer,
  path: string,
  environment: EditorPreparedEnvironment,
  abortSignal: AbortSignal,
  structuralRange: FileOpenIntentStructuralRange,
  highlighterProvider: EditorHighlighterProvider | null,
  structuralProvider: EditorSyntaxProvider | null,
): FileOpenIntentPreparationConfiguration {
  const languageId = languageIdForFilePath(path)
  const analysisAllowed = documentAnalysisAllowed(
    buffer.getSnapshot().length,
    environment.analysisLimitMiCodeUnits,
  )
  const source =
    environment.syntaxHighlightingEnabled && analysisAllowed
      ? editorSyntaxColors(environment.selectedThemeId, languageId)
      : 'disabled'
  const tags = editorPreparedDocumentTags(path, environment, analysisAllowed)
  const highlighter = highlighterPreparationStage(
    prepared,
    source,
    environment,
    tags,
    abortSignal,
    highlighterProvider,
  )
  const structural = structuralPreparationStage(
    prepared,
    languageId,
    source,
    tags,
    abortSignal,
    structuralRange,
    structuralProvider,
  )
  return {
    documentConfigurationTag: tags.documentConfigurationTag,
    stages: [highlighter, structural].filter(
      (stage): stage is FileOpenIntentPreparationStage => stage !== null,
    ),
  }
}

function structuralPreparationStage(
  prepared: EditorPreparedDocument,
  languageId: EditorSyntaxLanguageId | null,
  source: EditorSyntaxColors,
  tags: EditorPreparedDocumentTags,
  abortSignal: AbortSignal,
  range: FileOpenIntentStructuralRange,
  provider: EditorSyntaxProvider | null,
): FileOpenIntentPreparationStage | null {
  if (!languageId || source === 'disabled' || !provider) return null

  return {
    configurationTag: tags.structuralConfigurationTag,
    family: 'structural',
    provider,
    range,
    start: () =>
      prepared.startStage({
        abortSignal,
        configuration: {
          includeCaptures: languageId === 'markdown',
          includeHighlights: source === 'editor',
          syntaxMode: 'range',
        },
        configurationTag: tags.structuralConfigurationTag,
        family: 'structural',
        provider,
        range,
      }),
  }
}

function highlighterPreparationStage(
  prepared: EditorPreparedDocument,
  source: EditorSyntaxColors,
  environment: EditorPreparedEnvironment,
  tags: EditorPreparedDocumentTags,
  abortSignal: AbortSignal,
  provider: EditorHighlighterProvider | null,
): FileOpenIntentPreparationStage | null {
  if (source !== 'vscode') return null
  if (!environment.appliedThemeId) return null
  if (environment.appliedThemeId !== environment.selectedThemeId) return null
  if (!provider) return null

  return {
    configurationTag: tags.highlighterConfigurationTag,
    family: 'highlighter',
    provider,
    range: 'full',
    start: () =>
      prepared.startStage({
        abortSignal,
        configurationTag: tags.highlighterConfigurationTag,
        family: 'highlighter',
        provider,
        range: 'full',
      }),
  }
}

function preparedEnvironmentConfigurationTag(
  environment: EditorPreparedEnvironment,
): readonly EditorPreparedTagValue[] {
  return [
    environment.appliedThemeId,
    environment.appliedThemeContentHash,
    environment.selectedThemeId,
    environment.syntaxHighlightingEnabled,
    environment.analysisLimitMiCodeUnits,
    environment.tabSize,
  ]
}
