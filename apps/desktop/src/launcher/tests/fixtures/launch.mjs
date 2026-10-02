import path from 'node:path'
import { launchChromium } from '../../chromium.ts'

const root = process.argv[2]
await launchChromium({
  candidate: {
    kind: 'chromium',
    executable: process.execPath,
    args: [path.join(import.meta.dirname, 'browser.mjs'), 'pwa-unknown', path.join(root, 'pid')],
    confinement: 'none',
    source: 'setting',
    family: 'fixture',
  },
  stateHome: root,
  home: root,
  url: 'http://localhost:123/',
  startup: { idleMs: 500, limitMs: 2000 },
  onOpen: () => {},
  onFailure: () => {},
})
await Bun.write(path.join(root, 'returned'), 'handoff')
