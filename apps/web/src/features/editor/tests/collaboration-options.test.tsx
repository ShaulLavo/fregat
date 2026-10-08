import {
  COLLABORATION_ADMISSION_TOKEN_REF,
  COLLABORATION_TURN_CREDENTIALS_REF,
  DEFAULT_SETTING_VALUES,
  descriptorFor,
  type SettingsValues,
} from '@workspace/contracts'
import { mkdir, rm } from 'node:fs/promises'
import * as v from 'valibot'
import { afterEach } from 'vitest'
import { initLogger } from 'evlog'
import { createWideEventScope } from '@workspace/observability/scope'
import { SettingsStore } from '../../../../../server/src/settings/store'
import { SecretStore } from '../../../../../server/src/settings/secrets'
import { testSettingsOptions } from 'server/testing'
import { expect, test } from '../../../../test/fixtures'
import { BOOT_MIRROR_KEY } from '@/lib/boot-keys'
import { writeBootMirror } from '@/lib/settings-boot-mirror'
import { resolveCollaborationOptions } from '@/features/editor/state/collaboration-options'

const admissionToken = 'fixture_broker_admission_token_01234567890123456789'
const turnUrl = 'turns:relay.example.test:5349?transport=tcp'
const configured: SettingsValues = {
  ...DEFAULT_SETTING_VALUES,
  'editor.collaboration.signalingUrls': ['wss://broker.example.test/collaboration'],
  'editor.collaboration.iceServers': [{ urls: ['stun:stun.example.test:3478', turnUrl] }],
  'editor.collaboration.transportPolicy': 'relay-only',
  'editor.collaboration.displayName': 'Test participant',
  'editor.collaboration.colour': '#5684ff',
}

afterEach(() => localStorage.clear())

test('default configuration leaves collaboration unavailable with actionable guidance', async ({
  server,
}) => {
  const settings = new SettingsStore(testSettingsOptions(server.root))
  try {
    const error = await resolveCollaborationOptions(settings).catch((caught: unknown) => caught)
    expect(error).toMatchObject({
      code: 'collaboration.CONFIGURATION_UNAVAILABLE',
      status: 503,
      message: 'Collaboration is unavailable',
      why: expect.stringContaining('signaling broker'),
      fix: expect.stringContaining('WebSocket URL'),
      internal: { requirement: 'signaling' },
    })
  } finally {
    settings.close()
  }
})

test('real settings and secret stores resolve the plugin and adapter options', async ({
  server,
  client,
}) => {
  const response = await client.settings.write.post({
    mutationId: 'configure-collaboration',
    target: 'user',
    operations: [
      {
        kind: 'set',
        key: 'editor.collaboration.signalingUrls',
        value: configured['editor.collaboration.signalingUrls'],
      },
      {
        kind: 'set',
        key: 'editor.collaboration.iceServers',
        value: configured['editor.collaboration.iceServers'],
      },
      { kind: 'set', key: 'editor.collaboration.transportPolicy', value: 'relay-only' },
      { kind: 'set', key: 'editor.collaboration.displayName', value: 'Test participant' },
      { kind: 'set', key: 'editor.collaboration.colour', value: '#5684ff' },
    ],
  })
  expect(response.error).toBeNull()
  const options = testSettingsOptions(server.root)
  const secrets = new SecretStore(options.secretsFilePath!)
  await secrets.write(
    new Map([
      [COLLABORATION_ADMISSION_TOKEN_REF, admissionToken],
      [
        COLLABORATION_TURN_CREDENTIALS_REF,
        JSON.stringify({ [turnUrl]: { username: 'fixture-user', credential: 'fixture-password' } }),
      ],
    ]),
  )
  const settings = new SettingsStore(options)
  try {
    writeBootMirror(settings.snapshot().values)
    const resolved = await resolveCollaborationOptions(settings)
    expect(resolved.signaling.urls).toEqual(configured['editor.collaboration.signalingUrls'])
    expect(resolved.presence).toEqual({ displayName: 'Test participant', colour: '#5684ff' })
    expect(resolved.transport.iceServers).toEqual([{ urls: 'stun:stun.example.test:3478' }])
    expect(resolved.transport.transportPolicy).toBe('relay')
    expect({ ...resolved.signaling }.credentials.protocols).toBe(
      resolved.signaling.credentials.protocols,
    )
    expect({ ...resolved.transport }.credentials.turn).toBe(resolved.transport.credentials.turn)
    const signal = new AbortController().signal
    expect(await resolved.signaling.credentials.protocols(signal)).toEqual([admissionToken])
    expect(await resolved.transport.credentials.turn!('peer', signal)).toEqual([
      { urls: turnUrl, username: 'fixture-user', credential: 'fixture-password' },
    ])
    await secrets.write(
      new Map([
        [COLLABORATION_ADMISSION_TOKEN_REF, 'renewed_broker_admission_token_01234567890123456789'],
        [
          COLLABORATION_TURN_CREDENTIALS_REF,
          JSON.stringify({
            [turnUrl]: { username: 'renewed-user', credential: 'renewed-password' },
          }),
        ],
      ]),
    )
    expect(await resolved.transport.credentials.turn!('peer', signal)).toEqual([
      { urls: turnUrl, username: 'renewed-user', credential: 'renewed-password' },
    ])
    expect(await resolved.signaling.credentials.protocols(signal)).toEqual([
      'renewed_broker_admission_token_01234567890123456789',
    ])
    const aborted = new AbortController()
    aborted.abort()
    await expect(
      resolved.transport.credentials.turn!('peer', aborted.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
    await expect(resolved.signaling.credentials.protocols(aborted.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    const raw = await client.settings.raw.get({ query: { target: 'user' } })
    const serialized = JSON.stringify(raw.data)
    const mirrored = localStorage.getItem(BOOT_MIRROR_KEY)!
    expect(raw.error).toBeNull()
    for (const secret of [
      admissionToken,
      'renewed_broker_admission_token_01234567890123456789',
      'fixture-user',
      'fixture-password',
      'renewed-user',
      'renewed-password',
    ]) {
      expect(serialized).not.toContain(secret)
      expect(mirrored).not.toContain(secret)
      expect(JSON.stringify(settings.snapshot())).not.toContain(secret)
    }
  } finally {
    settings.close()
  }
})

test.for(['JSON', 'structuredClone', 'evlog'])(
  '%s serialization excludes collaboration credentials',
  async (format, { server }) => {
    const options = testSettingsOptions(server.root)
    await new SecretStore(options.secretsFilePath!).write(
      new Map([
        [COLLABORATION_ADMISSION_TOKEN_REF, admissionToken],
        [
          COLLABORATION_TURN_CREDENTIALS_REF,
          JSON.stringify({
            [turnUrl]: { username: 'fixture-user', credential: 'fixture-password' },
          }),
        ],
      ]),
    )
    const settings = new SettingsStore(options)
    try {
      writeBootMirror(configured)
      const resolved = await resolveCollaborationOptions(settings)
      const signal = new AbortController().signal
      expect(await resolved.signaling.credentials.protocols(signal)).toEqual([admissionToken])
      expect(await resolved.transport.credentials.turn!('peer', signal)).toEqual([
        { urls: turnUrl, username: 'fixture-user', credential: 'fixture-password' },
      ])
      let serialized: string
      if (format === 'evlog') {
        const events: Record<string, unknown>[] = []
        initLogger({
          enabled: true,
          silent: true,
          redact: true,
          stringify: true,
          drain: ({ event }) => {
            events.push(event)
          },
        })
        const scope = createWideEventScope({
          enabled: true,
          base: { action: 'collaboration.configuration', area: 'editor' },
        })
        scope.set({ options: resolved })
        scope.end()
        expect(events).toHaveLength(1)
        serialized = JSON.stringify(events)
      } else {
        serialized = JSON.stringify(
          format === 'structuredClone' ? structuredClone(resolved) : resolved,
        )
      }
      expect(serialized).toContain('Test participant')
      for (const secret of [admissionToken, 'fixture-user', 'fixture-password']) {
        expect(serialized).not.toContain(secret)
      }
    } finally {
      settings.close()
      if (format === 'evlog') initLogger({ enabled: false })
    }
  },
)

test('an unavailable secret store produces safe guidance', async ({ server }) => {
  const options = testSettingsOptions(server.root)
  const settings = new SettingsStore(options)
  try {
    await rm(options.secretsFilePath!, { force: true })
    await mkdir(options.secretsFilePath!, { recursive: true })
    writeBootMirror(configured)
    const error = await resolveCollaborationOptions(settings).catch((caught: unknown) => caught)
    expect(error).toMatchObject({
      internal: { requirement: 'secrets' },
      why: expect.stringContaining('secret store'),
      fix: expect.any(String),
    })
    expect(JSON.stringify(error)).not.toContain(server.root)
  } finally {
    settings.close()
  }
})

test('workspace settings cannot configure collaboration', async ({ client }) => {
  const response = await client.settings.write.post({
    mutationId: 'workspace-collaboration',
    target: 'workspace',
    operations: [{ kind: 'set', key: 'editor.collaboration.displayName', value: 'Workspace name' }],
  })
  expect(response.error).not.toBeNull()
  const snapshot = await client.settings.get()
  expect(snapshot.data?.values['editor.collaboration.displayName']).toBe('')
})

test('settings reject TURN passwords before writing them', async ({ client }) => {
  const response = await client.settings.write.post({
    mutationId: 'reject-turn-password',
    target: 'user',
    operations: [
      {
        kind: 'set',
        key: 'editor.collaboration.iceServers',
        value: [{ urls: turnUrl, credential: 'private-turn-password' }],
      },
    ],
  })
  expect(response.error).not.toBeNull()
  const raw = await client.settings.raw.get({ query: { target: 'user' } })
  expect(JSON.stringify(raw.data)).not.toContain('private-turn-password')
  expect(JSON.stringify(response.error)).not.toContain('private-turn-password')
})

test('STUN-only configuration resolves direct connections without TURN credentials', async ({
  server,
}) => {
  const options = testSettingsOptions(server.root)
  await new SecretStore(options.secretsFilePath!).write(
    new Map([[COLLABORATION_ADMISSION_TOKEN_REF, admissionToken]]),
  )
  const settings = new SettingsStore(options)
  try {
    writeBootMirror({
      ...configured,
      'editor.collaboration.iceServers': [{ urls: 'stun:stun.example.test' }],
      'editor.collaboration.transportPolicy': 'all',
    })
    const resolved = await resolveCollaborationOptions(settings)
    expect(resolved.transport).toEqual({
      iceServers: [{ urls: 'stun:stun.example.test' }],
      transportPolicy: 'all',
      credentials: {},
    })
  } finally {
    settings.close()
  }
})

test.for([
  {
    label: 'empty signaling',
    patch: { 'editor.collaboration.signalingUrls': [] },
    requirement: 'signaling',
  },
  { label: 'empty ICE', patch: { 'editor.collaboration.iceServers': [] }, requirement: 'ice' },
  {
    label: 'relay without TURN',
    patch: { 'editor.collaboration.iceServers': [{ urls: 'stun:stun.example.test' }] },
    requirement: 'relay',
  },
  {
    label: 'empty display name',
    patch: { 'editor.collaboration.displayName': '' },
    requirement: 'presence',
  },
  { label: 'empty colour', patch: { 'editor.collaboration.colour': '' }, requirement: 'presence' },
  { label: 'missing admission token', patch: {}, requirement: 'admission' },
])('$label produces a safe configuration error', async ({ patch, requirement }, { server }) => {
  const settings = new SettingsStore(testSettingsOptions(server.root))
  try {
    writeBootMirror({ ...configured, ...patch } as SettingsValues)
    await expect(resolveCollaborationOptions(settings)).rejects.toMatchObject({
      internal: { requirement },
      why: expect.any(String),
      fix: expect.any(String),
    })
  } finally {
    settings.close()
  }
})

test.for([
  null,
  '{invalid-private-json',
  '{}',
  JSON.stringify({ [turnUrl]: { username: 'private-user' } }),
])(
  'missing or malformed TURN credentials fail before starting a session',
  async (turnCredentials, { server }) => {
    const options = testSettingsOptions(server.root)
    await new SecretStore(options.secretsFilePath!).write(
      new Map([
        [COLLABORATION_ADMISSION_TOKEN_REF, admissionToken],
        [COLLABORATION_TURN_CREDENTIALS_REF, turnCredentials],
      ]),
    )
    const settings = new SettingsStore(options)
    try {
      writeBootMirror(configured)
      const error = await resolveCollaborationOptions(settings).catch((caught: unknown) => caught)
      expect(error).toMatchObject({ internal: { requirement: 'turn' } })
      expect(JSON.stringify(error)).not.toContain('private-user')
      expect(JSON.stringify(error)).not.toContain('invalid-private-json')
      expect(JSON.stringify(error)).not.toContain(admissionToken)
    } finally {
      settings.close()
    }
  },
)

test.for([
  ['editor.collaboration.signalingUrls', ['https://broker.example.test']],
  ['editor.collaboration.signalingUrls', ['wss://user:password@broker.example.test']],
  ['editor.collaboration.signalingUrls', ['wss://broker.example.test?token=private']],
  ['editor.collaboration.signalingUrls', ['invalid-url']],
  [
    'editor.collaboration.iceServers',
    [{ urls: 'turn:relay.example.test', username: 'private-user' }],
  ],
  [
    'editor.collaboration.iceServers',
    [{ urls: 'turn:relay.example.test', credential: 'private-password' }],
  ],
  ['editor.collaboration.iceServers', [{ urls: 'turn:user:password@relay.example.test' }]],
  ['editor.collaboration.iceServers', [{ urls: 'stun:stun.example.test:99999' }]],
  ['editor.collaboration.colour', 'red'],
  ['editor.collaboration.displayName', '\u0000participant'],
] as const)('registry rejects unsafe collaboration values %s', ([key, value]) => {
  expect(v.safeParse(descriptorFor(key).schema, value).success).toBe(false)
})

test('all collaboration settings use application scope', () => {
  for (const key of Object.keys(configured).filter((key) =>
    key.startsWith('editor.collaboration.'),
  )) {
    expect(descriptorFor(key as keyof SettingsValues).scope).toBe('application')
  }
})
