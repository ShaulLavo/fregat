import * as v from 'valibot'
import {
  DEFAULT_SETTING_VALUES,
  environmentIdSchema,
  orchestrationProjectSchema,
  orchestrationSessionSchema,
  orchestrationWorktreeSchema,
  providerSnapshotSchema,
  workspaceAddressSchema,
  type SettingsSnapshot,
} from '@workspace/contracts'

export const DEMO_TIME = '2026-09-14T10:00:00.000Z'
export const DEMO_ROOT = '/garden'
export const DEMO_ENVIRONMENT = v.parse(environmentIdSchema, '870e36a1-9832-4bbc-93b6-6aae112ff301')
export const DEMO_ADDRESS = v.parse(workspaceAddressSchema, {
  id: 'GardenDemoRoot01',
  name: 'garden',
  path: DEMO_ROOT,
})
export const DEMO_FILES: Readonly<Record<string, string>> = {
  'README.md': `# garden\n\nA little room for things to grow.\n\nGarden is a seasonal planting planner built with TypeScript.\nExplore the source, change a plant, and save your work.\n\n## Try the workspace\n\n- Edit src/garden.ts and save with Ctrl+S or Cmd+S.\n- Search for lavender across the project.\n- Review your changes in Git, stage them, and commit.\n- In the terminal, try help, ls, cat README.md, or bun test.\n- Ask the demo agent to explain the planting schedule.\n\nEverything here runs in your browser. Terminal commands and agent replies\nare simulated; no code is executed on a server. Reset starts a fresh garden.\n`,
  'package.json':
    JSON.stringify(
      {
        name: 'garden',
        private: true,
        type: 'module',
        scripts: { dev: 'vite', test: 'vitest run', build: 'tsc && vite build' },
        dependencies: { typescript: '^5.9.0', vite: '^7.0.0' },
      },
      null,
      2,
    ) + '\n',
  'src/garden.ts': `import { plants, type Plant } from './plants'\nimport { seasonFor, type Season } from './seasons'\n\nexport interface GardenBed {\n  name: string\n  sunlight: 'full' | 'partial'\n  plants: readonly Plant[]\n}\n\nexport const garden: readonly GardenBed[] = [\n  {\n    name: 'The sunny border',\n    sunlight: 'full',\n    plants: [plants.lavender, plants.rosemary, plants.sage],\n  },\n  {\n    name: 'By the kitchen door',\n    sunlight: 'partial',\n    plants: [plants.mint, plants.parsley],\n  },\n]\n\nexport function plantingSchedule(season: Season) {\n  return garden.flatMap((bed) =>\n    bed.plants\n      .filter((plant) => plant.plantingSeasons.includes(season))\n      .map((plant) => ({\n        bed: bed.name,\n        plant: plant.name,\n        spacing: plant.spacing,\n        note: plant.note,\n      })),\n  )\n}\n\nexport function gardenSummary(date = new Date()) {\n  const season = seasonFor(date)\n  const schedule = plantingSchedule(season)\n\n  return {\n    season,\n    beds: garden.length,\n    plants: garden.reduce((count, bed) => count + bed.plants.length, 0),\n    readyToPlant: schedule,\n  }\n}\n\nconsole.table(gardenSummary().readyToPlant)\n`,
  'src/plants.ts': `import type { Season } from './seasons'\n\nexport interface Plant {\n  name: string\n  spacing: number\n  plantingSeasons: readonly Season[]\n  note: string\n}\n\nexport const plants = {\n  lavender: {\n    name: 'Lavender',\n    spacing: 45,\n    plantingSeasons: ['spring', 'autumn'],\n    note: 'Give it sunshine and room to breathe.',\n  },\n  rosemary: {\n    name: 'Rosemary',\n    spacing: 60,\n    plantingSeasons: ['spring'],\n    note: 'Water sparingly once established.',\n  },\n  sage: {\n    name: 'Sage',\n    spacing: 40,\n    plantingSeasons: ['spring', 'autumn'],\n    note: 'Harvest little and often.',\n  },\n  mint: {\n    name: 'Mint',\n    spacing: 30,\n    plantingSeasons: ['spring', 'summer'],\n    note: 'Keep in a pot to give the neighbours space.',\n  },\n  parsley: {\n    name: 'Parsley',\n    spacing: 20,\n    plantingSeasons: ['spring', 'autumn'],\n    note: 'A little afternoon shade is welcome.',\n  },\n} satisfies Record<string, Plant>\n`,
  'src/seasons.ts': `export type Season = 'spring' | 'summer' | 'autumn' | 'winter'\n\nexport function seasonFor(date: Date): Season {\n  const month = date.getMonth()\n  if (month >= 2 && month <= 4) return 'spring'\n  if (month >= 5 && month <= 7) return 'summer'\n  if (month >= 8 && month <= 10) return 'autumn'\n  return 'winter'\n}\n`,
  'src/styles.css': `:root {\n  --leaf: #526f4d;\n  --canvas: #f0f1e8;\n  --ink: #253d34;\n  font-family: system-ui, sans-serif;\n  color: var(--ink);\n  background: var(--canvas);\n}\n\n.garden {\n  max-width: 72rem;\n  margin: 4rem auto;\n  padding: 2rem;\n}\n`,
  'tests/garden.test.ts': `import { expect, test } from 'vitest'\nimport { plantingSchedule, gardenSummary } from '../src/garden'\n\ntest('lavender is ready for autumn planting', () => {\n  const autumn = plantingSchedule('autumn')\n  expect(autumn.some((plant) => plant.plant === 'Lavender')).toBe(true)\n})\n\ntest('the garden has two beds', () => {\n  expect(gardenSummary().beds).toBe(2)\n})\n`,
  'notes/autumn.md':
    '# autumn in the garden\n\n- Plant lavender along the sunny border.\n- Leave the seed heads for the birds.\n- Bring the rosemary closer to the kitchen.\n',
  '.gitignore': 'node_modules/\ndist/\n',
  'tsconfig.json':
    '{\n  "compilerOptions": {\n    "target": "ES2022",\n    "module": "ESNext",\n    "strict": true,\n    "noEmit": true\n  },\n  "include": ["src"]\n}\n',
}

export function seedProject() {
  return v.parse(orchestrationProjectSchema, {
    id: 'a8e28c08-5ebd-4a35-bc21-fcb67b1ed101',
    title: 'garden',
    repositoryKey: 'demo-garden',
    repositoryKind: 'git',
    repositoryIdentity: { source: 'path', canonical: DEMO_ROOT },
    defaultModelSelection: { providerInstanceId: 'claude', model: 'demo-garden' },
    createdAt: DEMO_TIME,
    updatedAt: DEMO_TIME,
    deletedAt: null,
    scripts: [
      { name: 'test', command: 'bun test' },
      { name: 'dev', command: 'bun run dev' },
    ],
  })
}

export function seedWorktree() {
  return v.parse(orchestrationWorktreeSchema, {
    id: '97f21340-3b54-409f-a245-b2db75001401',
    projectId: seedProject().id,
    registrationGeneration: 1,
    canonicalPath: DEMO_ROOT,
    path: DEMO_ROOT,
    branch: 'main',
    kind: 'current',
    ownership: 'protected',
    lifecycle: { state: 'ready' },
    operationId: null,
    baseWorktreeId: null,
    baseCommit: null,
    headCommit: 'c4c9e4d7a12bf83ce9583f4d1cbfc4d264e65c21',
    metadataVersion: 1,
    pathKind: 'legacy',
    activeTerminalCount: 0,
    terminalOwnershipUnknown: false,
    externalDriverUnverified: false,
    removedAt: null,
    worktreeCreationCapability: { allowed: true },
    cleanupEligibility: {
      reason: 'protected',
      nonDeletedSessionCount: 1,
      canResolveMissing: false,
    },
    createdAt: DEMO_TIME,
    updatedAt: DEMO_TIME,
    retiredAt: null,
  })
}

export function seedSession(
  id = 'b8edbb35-2121-4d7a-93d5-bd7ddf0f9501',
  title = 'A little room to grow',
) {
  return v.parse(orchestrationSessionSchema, {
    id,
    worktreeId: seedWorktree().id,
    origin: 'platform',
    attentionState: 'settled',
    attentionReason: null,
    acknowledgedFailureThroughSequence: null,
    hasError: false,
    title,
    modelSelection: { providerInstanceId: 'claude', model: 'demo-garden' },
    runtimeMode: 'full-access',
    interactionMode: 'default',
    latestTurn: null,
    createdAt: DEMO_TIME,
    updatedAt: DEMO_TIME,
    archivedAt: null,
    deletedAt: null,
    activities: [],
    runtime: null,
    deletion: null,
    messages: [
      {
        id: 'welcome-garden',
        sessionId: id,
        role: 'assistant',
        text: 'Welcome to **garden**. This is a simulated agent conversation.\n\nThe workspace contains a small seasonal planting planner. Open `src/garden.ts`, try a change, and save it. I can explain the schedule, describe your changes, or help add a note to the garden.\n\nTry asking: **“How does the planting schedule work?”**',
        attachments: [],
        turnId: null,
        streaming: false,
        createdAt: DEMO_TIME,
        updatedAt: DEMO_TIME,
      },
    ],
  })
}

export function seedProviders() {
  return ['claude', 'codex'].map((name) =>
    v.parse(providerSnapshotSchema, {
      providerInstanceId: name,
      driverKind: name,
      displayLabel: name === 'claude' ? 'Claude Code' : 'Codex',
      enabled: true,
      installed: true,
      version: 'demo',
      status: 'ready',
      auth: { status: 'authenticated', type: 'demo', label: 'Simulated account' },
      checkedAt: DEMO_TIME,
      models: [{ slug: 'demo-garden', name: 'Garden demo', isCustom: false }],
      runtimeModes: ['full-access'],
      traits: {
        supportsApprovals: false,
        supportsFullAccess: true,
        supportsInterrupt: true,
        supportsSessionStop: true,
        supportsStreaming: true,
        supportsUserInput: false,
      },
      supportsSignIn: false,
      signInMethods: [],
    }),
  )
}

export function seedSettings(): SettingsSnapshot {
  const values = {
    ...DEFAULT_SETTING_VALUES,
    'workbench.colorTheme': 'dark' as const,
    'workbench.wallpaper.enabled': true,
    'workbench.surface.opacity': 78,
    'workbench.surface.contentOpacity': 82,
    'workbench.surface.blur': 0,
  }
  return {
    values,
    diagnostics: [],
    serverVersion: { epoch: 'garden-demo', sequence: 1 },
    layers: [
      {
        id: 'user',
        present: true,
        raw: values,
        file: {
          text: JSON.stringify(values, null, 2),
          revision: '1',
          parseErrors: [],
          keyRanges: {},
        },
      },
      {
        id: 'workspace',
        present: false,
        raw: {},
        file: { text: '{}', revision: '0', parseErrors: [], keyRanges: {} },
      },
      { id: 'policy', present: false, raw: {} },
    ],
  }
}
