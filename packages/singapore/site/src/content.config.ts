import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'
import { docsSchema } from '@astrojs/starlight/schema'

// Hand-written pages in plain Markdown render through src/pages/docs as editor pages; Starlight
// renders the MDX pages and the generated API reference.
export const collections = {
  docs: defineCollection({
    loader: glob({
      base: './src/content/docs',
      pattern: ['**/[^_]*.{md,mdx}', '!docs/{start-here,guides,concepts}/**/*.md'],
    }),
    schema: docsSchema(),
  }),
}
