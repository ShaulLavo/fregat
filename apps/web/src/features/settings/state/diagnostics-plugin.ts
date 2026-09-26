import type {
  EditorPlugin,
  EditorViewContribution,
  EditorViewContributionContext,
  EditorViewContributionUpdateKind,
  EditorViewSnapshot,
} from '@singapore-editor/core/extensions'
import {
  DiagnosticsPresenter,
  viewDocumentSnapshot,
} from '@singapore-editor/lsp-plugin/diagnostics-presenter'

import { documentKey, settingsJsonDocument } from '@/lib/documents/utils/identity'
import { textSnapshotEqualsText } from '@/lib/text-snapshot-equality'
import { settingsEditorDiagnostics } from '@/features/settings/utils/diagnostics'
import type { SettingsDiagnosticsSource } from '@/features/settings/state/diagnostics-source'

const PLUGIN_NAME = 'platform.settings-diagnostics'
const HIGHLIGHT_NAMESPACE = 'settings-diagnostics'
const MINIMAP_SOURCE_ID = 'platform.settings.diagnostics'
const MARKER_TIMING_PREFIX = 'settingsDiagnostics'

export function createSettingsDiagnosticsPlugin(source: SettingsDiagnosticsSource): EditorPlugin {
  return {
    name: PLUGIN_NAME,
    activate: (context) =>
      context.registerViewContribution({
        createContribution: (contributionContext) =>
          new SettingsDiagnosticsContribution(contributionContext, source),
      }),
  }
}

class SettingsDiagnosticsContribution implements EditorViewContribution {
  readonly inputs = ['content'] as const
  private readonly presenter: DiagnosticsPresenter
  private readonly unsubscribe: () => void

  constructor(
    context: EditorViewContributionContext,
    private readonly source: SettingsDiagnosticsSource,
  ) {
    this.presenter = new DiagnosticsPresenter(context, context.highlightPrefix, {
      highlightNameNamespace: HIGHLIGHT_NAMESPACE,
      markerTimingNamePrefix: MARKER_TIMING_PREFIX,
      minimapSourceId: MINIMAP_SOURCE_ID,
    })
    this.unsubscribe = source.subscribe(() => this.render(context.getSnapshot()))
  }

  update(snapshot: EditorViewSnapshot, kind: EditorViewContributionUpdateKind): void {
    if (kind === 'clear') {
      this.presenter.clear()
      return
    }
    this.render(snapshot)
  }

  dispose(): void {
    this.unsubscribe()
    this.presenter.clear()
  }

  private render(editor: EditorViewSnapshot): void {
    const snapshot = this.source.getSnapshot()
    const documentId = documentKey(settingsJsonDocument(snapshot.target))
    // The defaults document is generated, so nothing in it can be a diagnostic.
    if (snapshot.target === 'default' || !snapshot.file || editor.documentId !== documentId) {
      this.presenter.clear()
      return
    }
    if (!textSnapshotEqualsText(editor.textSnapshot, snapshot.file.text)) {
      this.presenter.clear()
      return
    }

    this.presenter.render(
      viewDocumentSnapshot(editor),
      settingsEditorDiagnostics(snapshot.target, snapshot.file, snapshot.diagnostics),
    )
  }
}
