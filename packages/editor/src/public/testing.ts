export {
  observeEditorMountTiming,
  resetEditorInstanceCount,
  setEditorSyntaxSessionFactory,
  setHighlightRegistry,
} from '../editor'
export { EditorPluginHost } from '../plugins'
export type { EditorPluginHostEvents } from '../plugins'
export {
  createTestCapabilityContributionContext,
  createTestEditContributionContext,
  createTestLineStartsView,
  createTestPluginContext,
  createTestViewContributionContext,
  createTestViewSnapshotSource,
} from '../testContexts'
export { createTestKeymap } from '../testKeymap'
export type { TestKeymap } from '../testKeymap'
export { reclaimPieceTableText } from '@singapore-editor/textbuffer/internal/reclamation'
// Tests that reach into an editor's own text view need the concrete class to narrow it.
export { VirtualizedTextView } from '../virtualization'
