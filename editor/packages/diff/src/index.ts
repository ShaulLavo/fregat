import './style.css'

export { createDiffPlugin, diffRowAtEvent } from './editorDiffPlugin'
export { createDiffEditorOptions } from './editorOptions'
export { createDiffRegionStore } from './regions'
export { annotateInlineChanges } from './inline'
export { joinRenderLines, splitTextLines } from './lines'
export { createLiveDiffProjection } from './liveProjection'
export { createTextDiff, parseGitPatch } from './model'
export { createSplitProjection, createStackedProjection } from './projection'
export {
  diffSyntaxBackend,
  prepareDiffSyntax,
  PreparedDiffSyntaxSource,
  projectDiffSyntaxTokens,
} from './diffSyntax'
export type { PrepareDiffSyntaxOptions, PreparedDiffSyntaxInput } from './diffSyntax'
export type { DiffPlugin, DiffPluginMode, DiffPluginOptions, DiffRowHit } from './editorDiffPlugin'
export type { DiffEditorOptions } from './editorOptions'
export type { DiffGutterSide } from './gutters'
export type { DiffRegionStore } from './regions'
export type { LiveDiffProjection } from './liveProjection'
export type {
  CreateTextDiffOptions,
  DiffFile,
  DiffFileChangeType,
  DiffHunk,
  DiffHunkLine,
  DiffInlineRange,
  DiffLineType,
  DiffRenderRow,
  DiffRenderRowType,
  DiffSyntaxBackend,
  DiffTextFile,
  ParseGitPatchOptions,
} from './types'
