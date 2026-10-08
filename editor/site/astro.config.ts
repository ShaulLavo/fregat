import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'
import { createStarlightTypeDocPlugin } from 'starlight-typedoc'
import linksValidator from 'starlight-links-validator'
import { packages } from './scripts/packages'

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

export default defineConfig({
  site: process.env.SITE_ORIGIN,
  trailingSlash: 'always',
  vite: {
    // The native Markdown binding resolves from its installed package directory.
    ssr: { external: ['satteri'] },
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
      sidebar: [
        {
          label: 'Start here',
          items: [
            { label: 'Introduction', slug: 'docs/start-here/introduction' },
            { label: 'Quick start', slug: 'docs/start-here/quick-start' },
            { label: 'Coming from Monaco', slug: 'docs/start-here/monaco' },
            { label: 'Coming from CodeMirror', slug: 'docs/start-here/codemirror' },
            { label: 'TypeScript playground', slug: 'docs/start-here/playground' },
          ],
        },
        { label: 'Guides', items: [{ autogenerate: { directory: 'docs/guides' } }] },
        {
          label: 'Reference',
          items: [
            { label: 'Packages', slug: 'docs/reference/packages' },
            ...references.map((entry) => entry.sidebar),
          ],
        },
        { label: 'Concepts', items: [{ autogenerate: { directory: 'docs/concepts' } }] },
      ],
      plugins: [...references.map((entry) => entry.plugin), linksValidator()],
    }),
  ],
})
