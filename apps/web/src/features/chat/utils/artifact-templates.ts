// Ported from t3code (MIT, T3 Tools Inc.): packages/client-runtime/src/codexArtifactTemplates.ts
// and the artifact-template part of codexMarkdownDirectives.ts, at references/t3code f5ef0ddb.

const ARTIFACT_KINDS = [
  'document',
  'presentation',
  'spreadsheet',
  'site',
  'google-docs',
  'google-slides',
  'google-sheets',
  'image',
  'email',
  'slack',
] as const
const GALLERY_KINDS = ['imagegen', 'product-design'] as const

export type ArtifactTemplateKind = (typeof ARTIFACT_KINDS)[number]

export type ArtifactTemplate = {
  readonly artifactKind: ArtifactTemplateKind
  readonly displayName: string
  readonly galleryKind?: (typeof GALLERY_KINDS)[number]
  readonly skillDirectory: string
  readonly skillName: string
}

export type ArtifactTemplateSegment =
  | { readonly kind: 'markdown'; readonly markdown: string; readonly lineOffset: number }
  | { readonly kind: 'artifact-template'; readonly template: ArtifactTemplate }

const LABEL_BY_KIND: Record<ArtifactTemplateKind, string> = {
  document: 'Document template',
  presentation: 'Presentation template',
  spreadsheet: 'Spreadsheet template',
  site: 'Site template',
  'google-docs': 'Google Doc template',
  'google-slides': 'Google Slides template',
  'google-sheets': 'Google Sheet template',
  image: 'Image template',
  email: 'Email template',
  slack: 'Slack template',
}

const USE_PROMPT_BY_KIND: Record<ArtifactTemplateKind, (skill: string) => string> = {
  document: (skill) => `Create a document using this ${skill} about…`,
  presentation: (skill) => `Create a presentation using the ${skill} template about…`,
  spreadsheet: (skill) => `Create a spreadsheet using this ${skill} about…`,
  site: (skill) => `Create a Site using this ${skill} about…`,
  'google-docs': (skill) => `Create a Google Doc using this ${skill} about…`,
  'google-slides': (skill) => `Create a Google Slides presentation using this ${skill} about…`,
  'google-sheets': (skill) => `Create a Google Sheet using this ${skill} about…`,
  image: (skill) => `Create an image using this ${skill} of…`,
  email: (skill) => `Draft an email using this ${skill} about…`,
  slack: (skill) => `Draft a Slack message using this ${skill} about…`,
}

const DIRECTIVE = '::artifact-template'
const DIRECTIVE_LINE = /^::artifact-template\{(.*)\}\s*$/
const ATTRIBUTE = /([a-z_]+)=(?:"([^"]*)"|'([^']*)'|([^\s"'}]+))/g
const FENCE = /^\s{0,3}(`{3,}|~{3,})/
const WINDOWS_DRIVE_PATH = /^[A-Za-z]:[\\/]/
const WINDOWS_UNC_PATH = /^(?:\\\\[^\\]+\\[^\\]+|\/\/[^/]+\/[^/]+)/

export function artifactTemplateLabel(kind: ArtifactTemplateKind) {
  return LABEL_BY_KIND[kind]
}

export function artifactTemplateUsePrompt(template: ArtifactTemplate) {
  return USE_PROMPT_BY_KIND[template.artifactKind](`$${template.skillName}`)
}

/** Mirrors the Codex result-card schema, so a malformed directive stays literal Markdown. */
export function resolveArtifactTemplate(
  attributes: Readonly<Record<string, string | undefined>>,
): ArtifactTemplate | null {
  const { artifact_kind: kind, gallery_kind: gallery, skill_directory: directory } = attributes
  const displayName = attributes.display_name?.trim()
  const skillName = attributes.skill_name
  if (!isArtifactKind(kind) || !displayName || !directory || !isAbsoluteDirectory(directory))
    return null
  if (!skillName?.startsWith('artifact-template-')) return null
  if (gallery !== undefined && !isGalleryKind(gallery)) return null

  return {
    artifactKind: kind,
    displayName,
    ...(gallery === undefined ? {} : { galleryKind: gallery }),
    skillDirectory: directory,
    skillName,
  }
}

/**
 * Splits out `::artifact-template{…}` lines outside code fences. While streaming, an
 * unfinished directive on the last line is held back so it never flashes as text.
 */
export function splitArtifactTemplateMarkdown(
  markdown: string,
  streaming = false,
): ArtifactTemplateSegment[] {
  if (!markdown.includes(DIRECTIVE)) return [{ kind: 'markdown', markdown, lineOffset: 0 }]

  const segments: ArtifactTemplateSegment[] = []
  const lines = markdown.split('\n')
  let pending: string[] = []
  let lineOffset = 0
  let fence: string | null = null
  for (const [index, line] of lines.entries()) {
    fence = nextFence(fence, line)
    const template = fence === null ? directiveTemplate(line) : null
    if (template) {
      pushMarkdown(segments, pending, lineOffset)
      pending = []
      lineOffset = index + 1
      segments.push({ kind: 'artifact-template', template })
      continue
    }
    if (streaming && fence === null && index === lines.length - 1 && line.startsWith(DIRECTIVE))
      continue
    pending.push(line)
  }
  pushMarkdown(segments, pending, lineOffset)

  return segments
}

/** The copy text of a card: its name and kind, as the rendered card reads. */
export function artifactTemplateCopyText(markdown: string) {
  return splitArtifactTemplateMarkdown(markdown)
    .map((segment) =>
      segment.kind === 'markdown'
        ? segment.markdown
        : `${segment.template.displayName} (${artifactTemplateLabel(segment.template.artifactKind)})`,
    )
    .join('\n')
}

function directiveTemplate(line: string) {
  const match = DIRECTIVE_LINE.exec(line)
  if (!match) return null
  const attributes: Record<string, string> = {}
  for (const attribute of (match[1] ?? '').matchAll(ATTRIBUTE)) {
    const [, name, doubleQuoted, singleQuoted, bare] = attribute
    if (name) attributes[name] = doubleQuoted ?? singleQuoted ?? bare ?? ''
  }

  return resolveArtifactTemplate(attributes)
}

function nextFence(open: string | null, line: string) {
  const marker = FENCE.exec(line)?.[1]
  if (!marker) return open
  if (open === null) return marker
  return marker[0] === open[0] && marker.length >= open.length ? null : open
}

function pushMarkdown(
  segments: ArtifactTemplateSegment[],
  lines: readonly string[],
  lineOffset: number,
) {
  const markdown = lines.join('\n')
  if (markdown.trim()) segments.push({ kind: 'markdown', markdown, lineOffset })
}

function isArtifactKind(value: string | undefined): value is ArtifactTemplateKind {
  return ARTIFACT_KINDS.some((kind) => kind === value)
}

function isGalleryKind(value: string): value is (typeof GALLERY_KINDS)[number] {
  return GALLERY_KINDS.some((kind) => kind === value)
}

function isAbsoluteDirectory(value: string) {
  if (value.startsWith('/') && !value.startsWith('//')) return true

  return WINDOWS_DRIVE_PATH.test(value) || WINDOWS_UNC_PATH.test(value)
}
