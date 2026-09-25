import path from 'node:path'

export function fileExtension(filePath: string) {
  const basename = path.basename(filePath).toLowerCase()
  if (basename === 'dockerfile') return 'Dockerfile'

  return path.extname(filePath)
}
