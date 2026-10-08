import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'
import { createStarlightTypeDocPlugin } from 'starlight-typedoc'
import linksValidator from 'starlight-links-validator'
import { existsSync } from 'node:fs'
import { packages } from './scripts/packages'
import { SECTIONS } from './src/manual/sections'

const references = packages.map((entry) => {
  const [typeDoc] = createStarlightTypeDocPlugin()
  return {
    // Symbol navigation lives in generated overviews, keeping each page's sidebar compact.
    sidebar: { label: entry.name, slug: `docs/reference/api/${entry.name.split('/')[1]}/overview` },
    plugin: typeDoc({
      entryPoints: entry.entryPoints,
      tsconfig: './tsconfig.typedoc.json',
      output: `docs/reference/api/${entry.name.split('/')[1]}`,
      sidebar: { label: entry.name, collapsed: true },
      typeDoc: {
        name: entry.name,
        excludePrivate: true,
        excludeInternal: true,
        excludeProtected: true,
        excludeTags: ['@example'],
        readme: 'none',
        disableSources: true,
        outputFileStrategy: 'members',
        // Namespace overviews must survive Starlight's removal of nested README pages.
        entryFileName: 'overview',
        validation: { notExported: false, invalidLink: false },
      },
    }),
  }
})

const manualPage = (slug: string) =>
  existsSync(new URL(`./src/content/docs/docs/${slug}.md`, import.meta.url))

export default defineConfig({
  site: process.env.SITE_ORIGIN,
  trailingSlash: 'always',
  vite: {
    // Native and WebAssembly bindings resolve from their installed package directories.
    ssr: { external: ['satteri', 'web-tree-sitter', 'tree-sitter-md'] },
    define: {
      __SINGAPORE_PACKAGES__: JSON.stringify(
        packages.map(({ name, entryPoints }) => ({ name, entryPointCount: entryPoints.length })),
      ),
    },
  },
  integrations: [
    starlight({
      title: 'Singapore',
      description: 'Documentation for the Singapore browser code editor.',
      customCss: ['./src/styles/site.css'],
      editLink: { baseUrl: 'https://github.com/ShaulLavo/fregat/edit/main/editor/site/' },
      social: [
        {
          icon: 'github',
          label: 'Source on GitHub',
          href: 'https://github.com/ShaulLavo/fregat/tree/main/editor',
        },
      ],
      sidebar: SECTIONS.map((section) => ({
        label: section.label,
        items: [
          ...section.pages.map(([slug, label]) =>
            manualPage(slug) ? { label, link: `/docs/${slug}/` } : { label, slug: `docs/${slug}` },
          ),
          ...(section.label === 'Reference' ? references.map((entry) => entry.sidebar) : []),
        ],
      })),
      plugins: [
        ...references.map((entry) => entry.plugin),
        // Editor pages are outside Starlight; scripts/links.ts checks every rendered link.
        linksValidator({ exclude: ['/docs/{start-here,guides,concepts}/**'] }),
      ],
    }),
  ],
})
