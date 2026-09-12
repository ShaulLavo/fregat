import { randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { link, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { isRecord } from '@workspace/contracts'
import { textFileVersion } from '../fs/version'
import { fsyncDirectory } from './json-document'
import { settingsErrors } from './structured-errors'
import { withSettingsWriteCoordinator } from './write-coordinator'

const SECRET_FILE_MODE = 0o600
const JOURNAL_VERSION = 1

type SettingsTransactionPhase = 'prepared' | 'settings-committed' | 'secrets-committed'

export type SettingsTransactionBoundary =
  | 'settings-staged'
  | 'settings-backed-up'
  | 'secrets-staged'
  | 'secrets-backed-up'
  | 'journal-prepared'
  | 'settings-renamed'
  | 'settings-directory-synced'
  | 'journal-settings-committed'
  | 'secrets-renamed'
  | 'secrets-directory-synced'
  | 'journal-secrets-committed'
  | 'cleanup-complete'

export type SettingsTransactionHooks = {
  readonly afterBoundary?: (boundary: SettingsTransactionBoundary) => void | Promise<void>
}

export type SettingsSecretTransaction = {
  readonly allowedSettingsPaths: readonly string[]
  readonly expectedSecretsRevision: string | null
  readonly expectedSettingsRevision: string | null
  readonly id: string
  readonly secretsPath: string
  readonly secretsText: string
  readonly settingsPath: string
  readonly settingsText: string
}

type TransactionRevisionMismatch = {
  readonly foundRevision: string | null
  readonly kind: 'revision-mismatch'
  readonly source: 'secrets' | 'settings'
}

export type SettingsSecretTransactionResult =
  | { readonly kind: 'committed'; readonly settingsRevision: string }
  | TransactionRevisionMismatch

type StagedTransaction =
  | { readonly journal: TransactionJournal; readonly kind: 'staged' }
  | TransactionRevisionMismatch

type JournalFile = {
  readonly backup: string | null
  readonly destination: string
  readonly newHash: string
  readonly oldHash: string | null
  readonly stage: string
}

type TransactionJournal = {
  readonly id: string
  readonly journalStage: string
  readonly phase: SettingsTransactionPhase
  readonly secrets: JournalFile
  readonly settings: JournalFile
  readonly version: number
}

export async function withSettingsSecretTransactionOwner<T>(
  secretsPath: string,
  operation: () => Promise<T>,
): Promise<T> {
  return withSettingsWriteCoordinator(secretsPath, operation)
}

export async function commitSettingsSecretTransactionOwned(
  transaction: SettingsSecretTransaction,
  hooks: SettingsTransactionHooks = {},
): Promise<SettingsSecretTransactionResult> {
  const journalPath = settingsTransactionJournalPath(transaction.secretsPath)
  if (existsSync(journalPath)) {
    recoverSettingsTransactionSync(transaction.allowedSettingsPaths, transaction.secretsPath)
  }
  const staged = await stageTransaction(transaction, hooks)
  if (staged.kind === 'revision-mismatch') return staged
  const { journal } = staged

  try {
    await writeJournal(journalPath, journal)
  } catch (error) {
    if (!journalMatchesSync(journalPath, journal)) await cleanupPreJournal(journal)
    throw error
  }
  await boundary(hooks, 'journal-prepared')

  const foundSecretsRevision = await currentHash(journal.secrets.destination)
  if (foundSecretsRevision !== journal.secrets.oldHash) {
    await cleanupTransaction(journalPath, journal)
    return { foundRevision: foundSecretsRevision, kind: 'revision-mismatch', source: 'secrets' }
  }

  const foundSettingsRevision = await currentHash(journal.settings.destination)
  if (foundSettingsRevision !== transaction.expectedSettingsRevision) {
    await cleanupTransaction(journalPath, journal)
    return { foundRevision: foundSettingsRevision, kind: 'revision-mismatch', source: 'settings' }
  }

  await rename(journal.settings.stage, journal.settings.destination)
  await boundary(hooks, 'settings-renamed')
  await fsyncDirectory(path.dirname(journal.settings.destination))
  await boundary(hooks, 'settings-directory-synced')
  const settingsCommitted = { ...journal, phase: 'settings-committed' as const }
  await replaceJournal(journalPath, settingsCommitted)
  await boundary(hooks, 'journal-settings-committed')

  await rename(journal.secrets.stage, journal.secrets.destination)
  await boundary(hooks, 'secrets-renamed')
  await fsyncDirectory(path.dirname(journal.secrets.destination))
  await boundary(hooks, 'secrets-directory-synced')
  const secretsCommitted = { ...journal, phase: 'secrets-committed' as const }
  await replaceJournal(journalPath, secretsCommitted)
  await boundary(hooks, 'journal-secrets-committed')

  await cleanupTransaction(journalPath, secretsCommitted)
  await boundary(hooks, 'cleanup-complete')

  return { kind: 'committed', settingsRevision: journal.settings.newHash }
}

/** Runs before either settings or secrets are read by SettingsStore. */
export function recoverSettingsTransactionSync(
  settingsPaths: readonly string[],
  secretsPath: string,
): void {
  const journalPath = settingsTransactionJournalPath(secretsPath)
  if (!existsSync(journalPath)) return

  const journal = readJournalSync(journalPath)
  assertJournalDestinations(journal, settingsPaths, secretsPath)
  const settingsState = destinationState(journal.settings)
  const secretsState = destinationState(journal.secrets)
  validateRecoveryArtifacts(journal.settings, settingsState)
  validateRecoveryArtifacts(journal.secrets, secretsState)
  if (settingsState === 'diverged' || secretsState === 'diverged') {
    restoreUnconflictedSide(journal.settings, settingsState)
    restoreUnconflictedSide(journal.secrets, secretsState)
    throw settingsErrors.TRANSACTION_RECOVERY_CONFLICT({})
  }

  rollForwardSync(journal.settings, settingsState)
  rollForwardSync(journal.secrets, secretsState)
  cleanupTransactionSync(journalPath, journal)
}

export function settingsTransactionJournalPath(secretsPath: string): string {
  return path.join(
    path.dirname(secretsPath),
    `.${path.basename(secretsPath)}.settings-transaction.json`,
  )
}

async function stageTransaction(
  transaction: SettingsSecretTransaction,
  hooks: SettingsTransactionHooks,
): Promise<StagedTransaction> {
  const artifactId = randomUUID()
  const settings = await planJournalFile(
    transaction.settingsPath,
    transaction.settingsText,
    artifactId,
  )
  const secrets = await planJournalFile(
    transaction.secretsPath,
    transaction.secretsText,
    artifactId,
  )
  const initialMismatch = transactionRevisionMismatch(transaction, settings, secrets)
  if (initialMismatch) return initialMismatch
  const journal: TransactionJournal = {
    id: transaction.id,
    journalStage: `${settingsTransactionJournalPath(transaction.secretsPath)}.${artifactId}.tmp`,
    phase: 'prepared',
    secrets,
    settings,
    version: JOURNAL_VERSION,
  }

  try {
    const settingsStaged = await stageJournalFile(
      settings,
      transaction.settingsText,
      hooks,
      'settings',
    )
    if (!settingsStaged) {
      await cleanupPreJournal(journal)
      return revisionMismatch('settings', await currentHash(settings.destination))
    }

    const secretsStaged = await stageJournalFile(secrets, transaction.secretsText, hooks, 'secrets')
    if (!secretsStaged) {
      await cleanupPreJournal(journal)
      return revisionMismatch('secrets', await currentHash(secrets.destination))
    }

    const finalMismatch = await stagedSourceMismatch(journal)
    if (!finalMismatch) return { journal, kind: 'staged' }

    await cleanupPreJournal(journal)
    return finalMismatch
  } catch (error) {
    await cleanupPreJournal(journal)
    throw error
  }
}

async function planJournalFile(
  destination: string,
  nextText: string,
  artifactId: string,
): Promise<JournalFile> {
  const directory = path.dirname(destination)
  await mkdir(directory, { recursive: true })
  const current = await readCurrentFile(destination)
  const stem = `.${path.basename(destination)}.${artifactId}`
  const stage = path.join(directory, `${stem}.stage`)
  const backup = current.text === null ? null : path.join(directory, `${stem}.backup`)

  return {
    backup,
    destination,
    newHash: textFileVersion(nextText),
    oldHash: current.text === null ? null : textFileVersion(current.text),
    stage,
  }
}

async function stageJournalFile(
  file: JournalFile,
  nextText: string,
  hooks: SettingsTransactionHooks,
  kind: 'settings' | 'secrets',
): Promise<boolean> {
  const mode = kind === 'secrets' ? SECRET_FILE_MODE : await existingMode(file.destination)
  await writeDurableFile(file.stage, nextText, mode)
  await boundary(hooks, `${kind}-staged`)
  if (!file.backup || file.oldHash === null) return true

  const currentText = await readFile(file.destination, 'utf8')
  if (textFileVersion(currentText) !== file.oldHash) return false
  await writeDurableFile(file.backup, currentText, mode)
  await boundary(hooks, `${kind}-backed-up`)

  return true
}

function transactionRevisionMismatch(
  transaction: SettingsSecretTransaction,
  settings: JournalFile,
  secrets: JournalFile,
): TransactionRevisionMismatch | null {
  if (settings.oldHash !== transaction.expectedSettingsRevision) {
    return revisionMismatch('settings', settings.oldHash)
  }
  if (secrets.oldHash !== transaction.expectedSecretsRevision) {
    return revisionMismatch('secrets', secrets.oldHash)
  }

  return null
}

async function stagedSourceMismatch(
  journal: TransactionJournal,
): Promise<TransactionRevisionMismatch | null> {
  const secretsRevision = await currentHash(journal.secrets.destination)
  if (secretsRevision !== journal.secrets.oldHash) {
    return revisionMismatch('secrets', secretsRevision)
  }

  const settingsRevision = await currentHash(journal.settings.destination)
  if (settingsRevision !== journal.settings.oldHash) {
    return revisionMismatch('settings', settingsRevision)
  }

  return null
}

function revisionMismatch(
  source: 'secrets' | 'settings',
  foundRevision: string | null,
): TransactionRevisionMismatch {
  return { foundRevision, kind: 'revision-mismatch', source }
}

async function readCurrentFile(filePath: string): Promise<{ text: string | null }> {
  try {
    return { text: await readFile(filePath, 'utf8') }
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return { text: null }
    throw error
  }
}

async function writeDurableFile(filePath: string, text: string, mode?: number): Promise<void> {
  const handle = await open(filePath, 'wx', mode)

  try {
    await handle.writeFile(text, 'utf8')
    await handle.sync()
  } catch (error) {
    await handle.close().catch(() => {})
    await rm(filePath, { force: true }).catch(() => {})
    throw error
  } finally {
    await handle.close().catch(() => {})
  }
}

async function writeJournal(filePath: string, journal: TransactionJournal): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeDurableFile(journal.journalStage, journalText(journal), SECRET_FILE_MODE)
  await fsyncAffectedDirectories(journal)
  await link(journal.journalStage, filePath)
  await rm(journal.journalStage)
  await fsyncDirectory(path.dirname(filePath))
}

async function replaceJournal(filePath: string, journal: TransactionJournal): Promise<void> {
  await writeDurableFile(journal.journalStage, journalText(journal), SECRET_FILE_MODE)
  await rename(journal.journalStage, filePath)
  await fsyncDirectory(path.dirname(filePath))
}

async function cleanupTransaction(filePath: string, journal: TransactionJournal): Promise<void> {
  const artifacts = transactionArtifacts(filePath, journal)
  await Promise.all(artifacts.map((artifact) => rm(artifact, { force: true })))
  await fsyncAffectedDirectories(journal)
}

async function cleanupPreJournal(journal: TransactionJournal) {
  const artifacts = transactionArtifacts(null, journal)
  await Promise.all(artifacts.map((artifact) => rm(artifact, { force: true })))
  await fsyncAffectedDirectories(journal)
}

async function fsyncAffectedDirectories(journal: TransactionJournal): Promise<void> {
  const directories = new Set([
    path.dirname(journal.settings.destination),
    path.dirname(journal.secrets.destination),
  ])
  for (const directory of directories) await fsyncDirectory(directory)
}

async function currentHash(filePath: string): Promise<string | null> {
  try {
    return textFileVersion(await readFile(filePath, 'utf8'))
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null
    throw error
  }
}

function readJournalSync(filePath: string): TransactionJournal {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    throw invalidRecovery('journal is unreadable')
  }

  if (!isTransactionJournal(parsed)) throw invalidRecovery('journal shape is invalid')
  return parsed
}

function isTransactionJournal(value: unknown): value is TransactionJournal {
  if (!isRecord(value)) return false
  if (value.version !== JOURNAL_VERSION) return false
  if (typeof value.id !== 'string' || !value.id) return false
  if (typeof value.journalStage !== 'string') return false
  if (!isTransactionPhase(value.phase)) return false

  return isJournalFile(value.settings) && isJournalFile(value.secrets)
}

function isJournalFile(value: unknown): value is JournalFile {
  if (!isRecord(value)) return false
  if (typeof value.destination !== 'string') return false
  if (typeof value.stage !== 'string') return false
  if (typeof value.newHash !== 'string') return false
  if (value.oldHash !== null && typeof value.oldHash !== 'string') return false

  return value.backup === null || typeof value.backup === 'string'
}

function isTransactionPhase(value: unknown): value is SettingsTransactionPhase {
  return value === 'prepared' || value === 'settings-committed' || value === 'secrets-committed'
}

function assertJournalDestinations(
  journal: TransactionJournal,
  settingsPaths: readonly string[],
  secretsPath: string,
) {
  const expectedSettingsPaths = new Set(settingsPaths.map((entry) => path.resolve(entry)))
  if (!expectedSettingsPaths.has(path.resolve(journal.settings.destination))) {
    throw invalidRecovery('journal settings destination is unexpected')
  }
  if (path.resolve(journal.secrets.destination) !== path.resolve(secretsPath)) {
    throw invalidRecovery('journal secrets destination is unexpected')
  }

  assertJournalArtifactPaths(journal.settings)
  assertJournalArtifactPaths(journal.secrets)
  assertJournalStagePath(journal.journalStage, secretsPath)
}

function assertJournalStagePath(stage: string, secretsPath: string) {
  const journalPath = settingsTransactionJournalPath(secretsPath)
  if (path.dirname(path.resolve(stage)) !== path.dirname(path.resolve(journalPath))) {
    throw invalidRecovery('journal stage directory is unexpected')
  }
  const name = path.basename(stage)
  if (name.startsWith(`${path.basename(journalPath)}.`) && name.endsWith('.tmp')) return

  throw invalidRecovery('journal stage name is unexpected')
}

function assertJournalArtifactPaths(file: JournalFile) {
  assertJournalArtifactPath(file.stage, file.destination, '.stage')
  if (file.backup) assertJournalArtifactPath(file.backup, file.destination, '.backup')
}

function assertJournalArtifactPath(artifact: string, destination: string, suffix: string) {
  if (path.dirname(path.resolve(artifact)) !== path.dirname(path.resolve(destination))) {
    throw invalidRecovery('journal artifact directory is unexpected')
  }
  const prefix = `.${path.basename(destination)}.`
  const name = path.basename(artifact)
  if (name.startsWith(prefix) && name.endsWith(suffix)) return

  throw invalidRecovery('journal artifact name is unexpected')
}

function destinationState(file: JournalFile): 'old' | 'new' | 'diverged' {
  const current = currentHashSync(file.destination)
  if (current === file.newHash) return 'new'
  if (current === file.oldHash) return 'old'

  return 'diverged'
}

function validateRecoveryArtifacts(file: JournalFile, state: 'old' | 'new' | 'diverged') {
  if (file.oldHash === null && file.backup !== null) {
    throw invalidRecovery('an absent old destination unexpectedly has a backup')
  }
  if (file.oldHash !== null) {
    if (!file.backup) throw invalidRecovery('old backup path is missing')
    assertArtifactHash(file.backup, file.oldHash, 'backup')
  }
  if (state === 'old') {
    assertArtifactHash(file.stage, file.newHash, 'stage')
    return
  }
  if (!existsSync(file.stage)) return

  assertArtifactHash(file.stage, file.newHash, 'stage')
}

function currentHashSync(filePath: string): string | null {
  try {
    return textFileVersion(readFileSync(filePath, 'utf8'))
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null
    throw invalidRecovery('transaction destination is unreadable')
  }
}

function rollForwardSync(file: JournalFile, state: 'old' | 'new') {
  if (state === 'new') return
  assertArtifactHash(file.stage, file.newHash, 'stage')
  renameSync(file.stage, file.destination)
  fsyncDirectorySync(path.dirname(file.destination))
}

function restoreUnconflictedSide(file: JournalFile, state: 'old' | 'new' | 'diverged') {
  if (state !== 'new') return
  if (file.oldHash === null) {
    rmSync(file.destination, { force: true })
    fsyncDirectorySync(path.dirname(file.destination))
    return
  }
  if (!file.backup) throw invalidRecovery('old backup path is missing')

  assertArtifactHash(file.backup, file.oldHash, 'backup')
  renameSync(file.backup, file.destination)
  fsyncDirectorySync(path.dirname(file.destination))
}

function assertArtifactHash(filePath: string, expected: string, kind: string) {
  const found = currentHashSync(filePath)
  if (found === expected) return

  throw invalidRecovery(`${kind} is missing or does not match its journal hash`)
}

function cleanupTransactionSync(filePath: string, journal: TransactionJournal) {
  for (const artifact of transactionArtifacts(filePath, journal)) rmSync(artifact, { force: true })
  const directories = new Set([
    path.dirname(journal.settings.destination),
    path.dirname(journal.secrets.destination),
  ])
  for (const directory of directories) fsyncDirectorySync(directory)
}

function transactionArtifacts(filePath: string | null, journal: TransactionJournal): string[] {
  return [
    journal.settings.stage,
    journal.settings.backup,
    journal.secrets.stage,
    journal.secrets.backup,
    journal.journalStage,
    filePath,
  ].filter((entry): entry is string => Boolean(entry))
}

async function existingMode(filePath: string): Promise<number | undefined> {
  try {
    return (await stat(filePath)).mode & 0o777
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined
    throw error
  }
}

function fsyncDirectorySync(directory: string) {
  mkdirSync(directory, { recursive: true })
  const descriptor = openSync(directory, 'r')
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

function journalText(journal: TransactionJournal) {
  return `${JSON.stringify(journal, null, 2)}\n`
}

function journalMatchesSync(filePath: string, journal: TransactionJournal) {
  try {
    return readFileSync(filePath, 'utf8') === journalText(journal)
  } catch {
    return false
  }
}

function invalidRecovery(detail: string) {
  return settingsErrors.TRANSACTION_RECOVERY_INVALID({ detail })
}

function errorCode(error: unknown) {
  return isRecord(error) && typeof error.code === 'string' ? error.code : undefined
}

async function boundary(hooks: SettingsTransactionHooks, name: SettingsTransactionBoundary) {
  await hooks.afterBoundary?.(name)
}
