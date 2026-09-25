/** The last path segment of a clone source, which names the folder it goes in. */
function repositoryName(source: string) {
  const trimmed = source
    .trim()
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
  return trimmed.split(/[/:]/).filter(Boolean).at(-1) ?? ''
}

/** `<parent>/<repository name>`, or empty until the repository names itself. */
export function cloneDestination(parent: string, source: string) {
  const name = repositoryName(source)
  if (!name) return ''
  const base = parent.replace(/\/+$/, '')
  return base ? `${base}/${name}` : name
}
