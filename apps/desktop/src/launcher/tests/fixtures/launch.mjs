import path from 'node:path'
import { launchChromium } from '../../chromium.ts'

const root = process.argv[2]
const mode = process.argv[3] ?? 'pwa-unknown'
const subject = process.argv[4]
await launchChromium({
  candidate: {
    kind: 'chromium',
    executable: process.execPath,
    args: [path.join(import.meta.dirname, 'browser.mjs'), mode, path.join(root, 'pid')],
    confinement: 'none',
    source: 'setting',
    family: 'fixture',
  },
  stateHome: root,
  home: root,
  url: subject ? `http://localhost:123/?subject=${subject}` : 'http://localhost:123/',
  startup: { idleMs: 500, limitMs: 2000 },
  onOpen: () => {},
})
await Bun.write(path.join(root, subject ? `returned-${subject}` : 'returned'), 'handoff')
