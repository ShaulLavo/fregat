const base = import.meta.env.BASE_URL.replace(/\/$/, '')

export const docsHref = (slug = '') => `${base}/docs/${slug ? `${slug}/` : ''}`

interface DocLink {
  readonly label: string
  readonly href: string
  readonly code?: boolean
}

export const docsIndex: readonly { readonly title: string; readonly links: readonly DocLink[] }[] =
  [
    {
      title: 'Start here',
      links: [
        { label: 'Quick start', href: docsHref('start/quick-start') },
        { label: 'A real shell in the browser', href: docsHref('start/real-shell') },
        { label: 'Coming from xterm.js', href: docsHref('start/xterm') },
        { label: 'Coming from ghostty-web', href: docsHref('start/ghostty-web') },
      ],
    },
    {
      title: 'Guides',
      links: [
        { label: 'Connect to a PTY', href: docsHref('guides/pty') },
        { label: 'Renderers and fallbacks', href: docsHref('guides/renderers') },
        { label: 'Run in a worker', href: docsHref('guides/workers') },
        { label: 'Fonts', href: docsHref('guides/fonts') },
      ],
    },
    {
      title: 'Reference',
      links: [
        { label: 'ghostty-webgpu', href: docsHref('reference/api'), code: true },
        { label: '/worker', href: docsHref('reference/worker-api'), code: true },
        { label: 'Options', href: docsHref('reference/options') },
        { label: 'Config resolver', href: docsHref('reference/config-api') },
      ],
    },
    {
      title: 'Concepts',
      links: [
        { label: 'How it works', href: docsHref('concepts/how-it-works') },
        { label: 'Damage tracking', href: docsHref('concepts/damage-tracking') },
        { label: 'Benchmarks', href: docsHref('concepts/benchmarks') },
        {
          label: 'Correctness',
          href: 'https://github.com/ShaulLavo/ghostty-webgpu/blob/main/docs/correctness.md',
        },
      ],
    },
  ]

export const roadmap: readonly {
  readonly state: 'done' | 'progress' | 'planned'
  readonly text: string
}[] = [
  { state: 'progress', text: 'WebGL line scroll and Unicode cost, the two WebGL losses above.' },
  { state: 'progress', text: 'DOM typing-like edit cost.' },
  { state: 'planned', text: 'Search in scrollback, with decorations for highlights.' },
  {
    state: 'planned',
    text: 'Progress, working-directory and notification events. Ghostty already parses them.',
  },
  {
    state: 'done',
    text: "Worker entry, first frame rendered into the page's HTML, shared GPU device across terminals.",
  },
]
