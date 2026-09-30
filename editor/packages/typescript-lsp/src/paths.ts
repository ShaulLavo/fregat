export {
  documentUriToFileName,
  fileNameToDocumentUri,
  pathOrUriToDocumentUri,
  sourcePathToFileName,
} from '@singapore-editor/lsp-plugin/paths'

const TYPE_SCRIPT_EXTENSIONS = new Set(['.cts', '.mts', '.ts', '.tsx'])
const TYPE_SCRIPT_LSP_SOURCE_EXTENSIONS = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
])

export function isTypeScriptFileName(fileName: string): boolean {
  return TYPE_SCRIPT_EXTENSIONS.has(extensionForPath(fileName))
}

export function isTypeScriptLspSourceFileName(fileName: string): boolean {
  return TYPE_SCRIPT_LSP_SOURCE_EXTENSIONS.has(extensionForPath(fileName))
}

function extensionForPath(path: string): string {
  const fileName = path.slice(path.lastIndexOf('/') + 1)
  const dotIndex = fileName.lastIndexOf('.')
  if (dotIndex === -1) return ''
  return fileName.slice(dotIndex).toLowerCase()
}
