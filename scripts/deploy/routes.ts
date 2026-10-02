type MeshRoute = {
  route: string
  host: string
  kind: string
  target: string
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

  return lines
    .slice(headerIndex + 1)
    .filter((line) => line.trim())
    .map((line) => {
      const [route, host, kind, target] = fields.map((field) =>
        line.slice(field!.start, field!.end).trim(),
      )
      return { route: route!, host: host!, kind: kind!, target: target! }
    })
}
