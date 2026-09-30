export function diagramClassNames(names: string): string {
  return names.replace(/[^\s,]+/g, (name) => (name === 'default' ? name : `mermaid_user_${name}`))
}

export function isolateDiagramRecords(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(isolateDiagramRecords)
  if (!value || typeof value !== 'object' || (!('stmt' in value) && !('type' in value)))
    return value
  const statement = 'stmt' in value ? value.stmt : value.type
  return Object.fromEntries(
    Object.entries(value).map(([key, field]) => [key, isolateRecordField(statement, key, field)]),
  )
}

function isolateRecordField(statement: unknown, key: string, value: unknown): unknown {
  if (key === 'doc' || key === 'state1' || key === 'state2' || key === 'children')
    return isolateDiagramRecords(value)
  if (statement === 'classDef' && key === 'id' && typeof value === 'string')
    return diagramClassNames(value)
  if (statement === 'applyClass' && key === 'styleClass' && typeof value === 'string')
    return diagramClassNames(value)
  if (statement === 'state' && key === 'classes' && Array.isArray(value))
    return value.map((name) => (typeof name === 'string' ? diagramClassNames(name) : name))
  return value
}

export function isolateDiagramDecoration(value: unknown): unknown {
  if (!value || typeof value !== 'object' || !('class' in value) || typeof value.class !== 'string')
    return value
  return { ...value, class: diagramClassNames(value.class) }
}
