// Strings and comments can contain @names that are not query captures.
const QUERY_TOKEN = /;[^\n]*|"(?:\\.|[^"\\])*"|@([a-zA-Z_][a-zA-Z0-9_.-]*)/g

export function mapQueryCaptures(
  source: string,
  mappings: Readonly<Record<string, string>>,
): string {
  return source.replace(QUERY_TOKEN, (token, name: string | undefined) => {
    if (!name || !Object.hasOwn(mappings, name)) return token
    return `@${mappings[name]}`
  })
}
