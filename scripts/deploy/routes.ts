type MeshRoute = {
  route: string
  host: string
  kind: string
  target: string
  url: string
}

export function parseMeshRoutes(table: string): MeshRoute[] {
  const lines = table.split('\n')
  const headerIndex = lines.findIndex((line) => /^\s*ROUTE\s/.test(line))
  if (headerIndex < 0) return []

  const columns = [...lines[headerIndex]!.matchAll(/\S+/g)]
  const fields = ['ROUTE', 'HOST', 'KIND', 'TARGET'].map((name) => {
    const index = columns.findIndex((column) => column[0] === name)
    if (index < 0) return null
    return { start: columns[index]!.index, end: columns[index + 1]?.index }
  })
  if (fields.some((field) => field === null)) return []
  const urlColumn = columns.find((column) => column[0] === 'URL')

  return lines
    .slice(headerIndex + 1)
    .filter((line) => line.trim())
    .map((line) => {
      const [route, host, kind, target] = fields.map((field) =>
        line.slice(field!.start, field!.end).trim(),
      )
      return {
        route: route!,
        host: host!,
        kind: kind!,
        target: target!,
        url: urlColumn ? line.slice(urlColumn.index).trim() : '',
      }
    })
}

export function matchesMeshRoute(
  route: MeshRoute,
  expectedRoute: string,
  expectedUrl: string,
  expectedPort: number,
): boolean {
  return (
    route.route === expectedRoute &&
    route.kind === 'proxy' &&
    route.target === String(expectedPort) &&
    route.url.replace(/\/$/, '') === expectedUrl.replace(/\/$/, '')
  )
}
