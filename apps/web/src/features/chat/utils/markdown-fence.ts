/**
 * Fence chrome: what a code block calls itself. Agents label fences either with
 * an attribute (```ts title="src/foo.ts") or a bare filename (```ts src/foo.ts),
 * and both are worth more to the reader than the language id alone.
 */

const FENCE_TITLE_ATTRIBUTE = /(?:^|\s)(?:title|file(?:name)?)=(?:"([^"]+)"|'([^']+)'|(\S+))/iu
const FENCE_FILENAME_TOKEN = /^[\w@][\w@./-]*\.[A-Za-z0-9]+$/u

/** Extensions whose shiki language id is not itself a usable file extension. */
const EXTENSION_BY_LANGUAGE: Record<string, string> = {
  bash: 'sh',
  csharp: 'cs',
  dockerfile: 'dockerfile',
  golang: 'go',
  javascript: 'js',
  jsonc: 'json',
  markdown: 'md',
  objective_c: 'm',
  plaintext: 'txt',
  python: 'py',
  ruby: 'rb',
  rust: 'rs',
  shell: 'sh',
  shellscript: 'sh',
  text: 'txt',
  typescript: 'ts',
  yaml: 'yml',
}

export function fenceTitle(meta: string | undefined): string | null {
  if (!meta) return null

  const attribute = FENCE_TITLE_ATTRIBUTE.exec(meta)
  const declared = attribute?.[1] ?? attribute?.[2] ?? attribute?.[3]
  if (declared) return declared

  return meta.split(/\s+/u).find((token) => FENCE_FILENAME_TOKEN.test(token)) ?? null
}

/**
 * The name the shared file-icon resolver is asked about. A titled fence uses its
 * real name so `package.json` gets the json icon; an untitled one borrows a
 * synthetic name so the language still picks up an icon.
 */
export function fenceIconFileName(title: string | null, language: string) {
  if (title) return title.slice(title.lastIndexOf('/') + 1)

  const normalized = language.toLowerCase()

  return `file.${EXTENSION_BY_LANGUAGE[normalized] ?? normalized}`
}

const MERMAID_FENCE = /^ {0,3}(?:`{3,}|~{3,}) *mermaid\b/mu

/** Whether the text opens a mermaid fence — the cue to load the diagram plugin. */
export function hasMermaidFence(text: string): boolean {
  return MERMAID_FENCE.test(text)
}
