import { defaultSchema } from 'rehype-sanitize'

type Schema = typeof defaultSchema

const attributes = defaultSchema.attributes ?? {}
const protocols = defaultSchema.protocols ?? {}

/** Every `id`, `name` and aria reference from the document; `document.getSelection` stays ours. */
export const MARKDOWN_ID_PREFIX = 'user-content-'

/**
 * GitHub's schema, plus the fence metastring and the streaming marker on an
 * unfinished link, which the pipeline itself sets. Nothing a consumer passes
 * can loosen this; overrides only add rendering. The hast stage leaves ids
 * bare, so this is the one place they are prefixed.
 */
export const MARKDOWN_SANITIZE_SCHEMA: Schema = {
  ...defaultSchema,
  attributes: {
    ...attributes,
    a: [...(attributes.a ?? []), 'dataIncomplete'],
    code: [...(attributes.code ?? []), 'dataMeta'],
  },
  clobberPrefix: MARKDOWN_ID_PREFIX,
  protocols: {
    ...protocols,
    href: [...(protocols.href ?? []), 'tel', 'vscode', 'vscode-insiders', 'ssh'],
  },
}
