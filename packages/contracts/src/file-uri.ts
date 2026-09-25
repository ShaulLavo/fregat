/**
 * The editor's `fileNameToDocumentUri`, pinned by a parity test in `apps/web`. A backslash becomes
 * `/` so the editor's `documentUriToFileName` decodes the URI back to the same path.
 */
export function fileUriForPath(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/^\/+/, '')
  return `file:///${normalized.split('/').map(encodeURIComponent).join('/')}`
}
