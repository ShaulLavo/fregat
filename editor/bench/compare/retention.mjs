export function verifyDisposedRetention(before, multiple, after) {
  const total = (snapshots) => snapshots.reduce((sum, item) => sum + item.documentCount, 0)
  if (total(multiple) < total(before) + 2)
    throw new RangeError('Multiple-document retention did not include the extra documents')
  const resources = (snapshots) =>
    snapshots
      .map((item) => ({
        worker: item.worker,
        documentCount: item.documentCount,
        snapshotCount: item.snapshotCount,
        treeCount: item.treeCount,
        markdownDocumentEntries: item.markdownDocumentEntries,
        markdownDocumentCount: item.markdownDocumentCount,
        injectedMarkdownDocumentCount: item.injectedMarkdownDocumentCount,
        documents: item.documents
          .toSorted((a, b) => a.runtimeSessionId.localeCompare(b.runtimeSessionId))
          .map((document) => ({
            ...document,
            snapshots: document.snapshots.toSorted((a, b) => a.snapshotVersion - b.snapshotVersion),
          })),
        source: item.source,
      }))
      .toSorted((a, b) => a.worker - b.worker)
  if (JSON.stringify(resources(before)) !== JSON.stringify(resources(after)))
    throw new RangeError(
      'Snapshot, tree and source retention did not return to baseline after disposal',
    )
}
