export const documentSymbolKeys = {
  all: ['document-symbols'] as const,
  document: (rootPath: string, path: string, contentRevision: string) =>
    [...documentSymbolKeys.all, rootPath, path, contentRevision] as const,
}
