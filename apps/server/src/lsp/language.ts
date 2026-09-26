import path from 'node:path'

export function fileExtension(filePath: string) {
  const basename = path.basename(filePath).toLowerCase()
  if (basename === 'dockerfile') return 'Dockerfile'

  return path.extname(filePath)
}

// Native POSIX filenames retain backslashes; the editor's portable URI policy folds them.
export function fileUriForNativePath(filePath: string): string {
  const normalized = filePath.split(path.sep).join('/').replace(/^\/+/, '')
  return `file:///${normalized.split('/').map(encodeURIComponent).join('/')}`
}
