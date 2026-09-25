import { Alert } from '@workspace/ui/components/alert'
import { useDiffReloadView } from '@/features/git/hooks/use-diff-reload-view'
import { diffDocumentQueryKey } from '@/features/git/utils/diff-document-query'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { languageIdForFilePath } from '@/features/editor/utils/file-path'
import { useMemo, useRef } from 'react'

import { DiffEditor } from '@/features/editor/components/diff-editor'
import { EditorTabPlaceholder } from '@/features/editor/components/tab-placeholder'
import { useDiffLanguageContext } from '@/features/editor/hooks/use-diff-language-context'
import { useTabPresentation } from '@/features/editor/hooks/use-tab-presentation'
import type { DiffLanguageHost } from '@/features/editor/utils/diff-language-context'
import type { FilesystemPath, GitComparison, TabId } from '@/lib/documents/utils/types'
import { useDiffDocumentDiffs } from '../hooks/use-diff-document-diffs'
import { diffFileNotice, emptyDiffNotice, unrenderableDiffNotice } from '../utils/diff-presentation'
import { editorDiffFiles, renderableDiffFile } from '@workspace/client-core/git/diff-files'
import { DiffLineCommentAction } from './diff-line-comment-action'
import { DiffNotice } from './diff-notice'
import { DiffBanner } from './diff-banner'
import { useSettingValue } from '@/hooks/use-setting-value'

/**
 * Renders a `git-diff:` document as real editors carrying the diff plugin, so a
 * diff gets the same tree-sitter highlighting, theming and virtualized scrolling
 * a file does. Snapshot ids (the git panel) resolve to one file; checkpoint ids
 * resolve to one file for a `file` scope and to every touched file for a `turn`
 * or `session` scope.
 */
export function DiffView({
  comparison,
  languageHost,
  rootPath,
  tabId,
}: {
  comparison: GitComparison
  languageHost: DiffLanguageHost
  rootPath: FilesystemPath
  tabId?: TabId
}) {
  const { diffs, failure, pending } = useDiffDocumentDiffs(comparison)
  const mode = useSettingValue('editor.diff.viewMode')
  const containerRef = useRef<HTMLDivElement | null>(null)
  // One store, read by both split panes and by the comment layer. The layer does
  // not keep a copy of which regions are open — the mirror it used to keep was
  // keyed by hunk ordinal, which a trailing-tail region does not have.
  const presentation = useTabPresentation(tabId)
  // A checkpoint keeps its own hunks over the loaded sources; they carry its whitespace policy.
  const hunkSource = comparison.kind === 'snapshot' ? 'text' : 'patch'
  // Stable identity is required: this is pushed into the plugin, and a fresh
  // array each render would re-project the diff and throw away scroll position.
  const files = useMemo(
    () => editorDiffFiles(diffs, languageIdForFilePath, hunkSource),
    [diffs, hunkSource],
  )
  // A file with hunks wins; a hunkless one is drawn only when it carries whole-file text, which is
  // what a pure rename looks like once the server sends the blob. A binary entry has neither and
  // still falls through to a notice — "we got diffs" is not the same as "there is something to
  // draw".
  //
  // One pass over the whole list rather than a `some` beside a `files[0]`: those are two decisions
  // that have to agree and nothing made them. The file list is off either way for a multi-file
  // diff, so a checkpoint diff touching several files deliberately shows one.
  const file = renderableDiffFile(files)
  useDiffReloadView(JSON.stringify(diffDocumentQueryKey(comparison)), diffs, file, presentation)
  // What an editor tab currently holds for this path, if anything. That is the only text a
  // language server can be asked about, and comparing it to the diff's new side is what makes an
  // answer true — see `diffQueryTargetAt`. Called before the early returns below: hooks are not
  // conditional.
  // Only an unstaged working-tree diff draws the file as it is on disk; a staged diff draws the
  // index blob and a checkpoint a historical commit. That decides whether the new side may be
  // published to the language server under the file's own uri.
  const languagePath = file?.newPath || file?.path || null
  const languageServer = useDiffLanguageContext(
    languagePath === null ? null : filesystemPath(languagePath),
    rootPath,
    comparison.kind === 'snapshot' && comparison.source === 'worktree',
    languageHost,
  )

  if (!pending && !failure && diffs.length === 0) {
    return (
      <EditorTabPlaceholder tabId={tabId}>
        <DiffNotice message={emptyDiffNotice(comparison, rootPath)} />
      </EditorTabPlaceholder>
    )
  }
  if (!pending && !failure && !file) {
    return (
      <EditorTabPlaceholder tabId={tabId}>
        <DiffNotice message={unrenderableDiffNotice(diffs, comparison, rootPath)} />
      </EditorTabPlaceholder>
    )
  }

  const notice = file ? diffFileNotice(file, rootPath) : null

  return (
    <div
      aria-busy={pending || undefined}
      className='relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden'
    >
      {failure ? (
        <Alert className='bg-popover-solid text-destructive absolute right-2 bottom-2 z-10 max-w-sm'>
          {failure}
        </Alert>
      ) : null}
      {notice ? <DiffBanner notice={notice} /> : null}
      {/* The ref is on the panes and not on the wrapper the toolbar shares: the
          comment layer listens for `mousedown` in capture, and a press on its own
          "Ask" button would otherwise clear the selection before the click landed. */}
      <div className='min-h-0 w-full min-w-0 flex-1' ref={containerRef}>
        <DiffEditor
          file={file}
          failure={failure}
          languageServer={file ? languageServer : null}
          mode={mode}
          presentation={presentation}
          tabId={tabId}
        />
      </div>
      {file ? (
        <DiffLineCommentAction
          file={file}
          hostRef={containerRef}
          key={file.path}
          getStackedRows={() => {
            const panes = presentation.diffPanes
            return (
              (panes.stacked.plugin ?? panes.new.plugin ?? panes.old.plugin)?.getStackedRows() ?? []
            )
          }}
        />
      ) : null}
    </div>
  )
}
