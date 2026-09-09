import {
  createEditorPreparedDocument,
  type EditorHighlighterProvider,
  type EditorPreparedDocument,
  type EditorPreparedTagValue,
  type EditorSyntaxProvider,
  type EditorSyntaxLanguageId,
  type EditorTextBuffer,
} from '@singapor/core'

import { languageIdForFilePath } from '@/features/editor/utils/file-path'
import {
  editorShikiHighlighterProvider,
  editorSyntaxHighlightingSource,
  editorTreeSitterSyntaxProvider,
  type EditorSyntaxHighlightingSource,
} from '@/features/editor/state/syntax-highlighting'
import type {
  FileOpenIntentPreparationConfiguration,
  FileOpenIntentPreparationStage,
  FileOpenIntentPreparer,
  FileOpenIntentStructuralRange,
} from '@/lib/file-open-intent/state/service'

const DEFAULT_EDITOR_TAB_SIZE = 4

export type EditorPreparedEnvironment = {
  readonly appliedThemeContentHash: string | null
  readonly appliedThemeId: string | null
  readonly selectedThemeId: string
  readonly syntaxHighlightingEnabled: boolean
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
    ? editorSyntaxHighlightingSource(environment.selectedThemeId)
    : 'disabled'
  const highlighterProvider = source === 'shiki' ? editorShikiHighlighterProvider() : null
  const structuralProvider = source === 'disabled' ? null : editorTreeSitterSyntaxProvider()
  return {
    environment: {
      configurationTag: preparedEnvironmentConfigurationTag(environment),
      highlighterProvider,
      structuralProvider,
    },
    prepare: (buffer, documentId, path, abortSignal, structuralRange) => {
      const preparedDocument = prepareEditorDocument(buffer, documentId, path, environment)
      return {
        buffer,
        preparedDocument,
        ...preparedDocumentConfiguration(
          preparedDocument,
          path,
          environment,
          abortSignal,
          structuralRange,
          highlighterProvider,
          structuralProvider,
        ),
      }
    },
    reconfigure: (preparedDocument, _buffer, _documentId, path, abortSignal, structuralRange) =>
      preparedDocumentConfiguration(
        preparedDocument,
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
  environment: EditorPreparedEnvironment,
): EditorPreparedDocumentTags {
  const languageId = languageIdForFilePath(path)
  const source = environment.syntaxHighlightingEnabled
    ? editorSyntaxHighlightingSource(environment.selectedThemeId)
    : 'disabled'
  const captures = languageId === 'markdown'
  return {
    documentConfigurationTag: ['platform-editor', languageId, source],
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
): EditorPreparedDocument {
  const languageId = languageIdForFilePath(path)
  const tags = editorPreparedDocumentTags(path, environment)
  return createEditorPreparedDocument({
    buffer,
    configuredTabSize: DEFAULT_EDITOR_TAB_SIZE,
    tabSizePolicy: 'detect-indentation',
    documentConfigurationTag: tags.documentConfigurationTag,
    documentId,
    languageId,
  })
}

function preparedDocumentConfiguration(
  prepared: EditorPreparedDocument,
  path: string,
  environment: EditorPreparedEnvironment,
  abortSignal: AbortSignal,
  structuralRange: FileOpenIntentStructuralRange,
  highlighterProvider: EditorHighlighterProvider | null,
  structuralProvider: EditorSyntaxProvider | null,
): FileOpenIntentPreparationConfiguration {
  const languageId = languageIdForFilePath(path)
  const source = environment.syntaxHighlightingEnabled
    ? editorSyntaxHighlightingSource(environment.selectedThemeId)
    : 'disabled'
  const tags = editorPreparedDocumentTags(path, environment)
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
  source: EditorSyntaxHighlightingSource,
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
          includeHighlights: source === 'tree-sitter',
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
  source: EditorSyntaxHighlightingSource,
  environment: EditorPreparedEnvironment,
  tags: EditorPreparedDocumentTags,
  abortSignal: AbortSignal,
  provider: EditorHighlighterProvider | null,
): FileOpenIntentPreparationStage | null {
  if (source !== 'shiki') return null
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
  ]
}
