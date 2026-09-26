import { mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createMetadataDatabase, type MetadataDatabaseHandle } from '../client'
import { initializePlatformDatabase } from '../initialize'
import { migratePlatformDatabase, platformMigrations } from '../migrations'

const handles: MetadataDatabaseHandle[] = []
const directories: string[] = []

afterEach(() => {
  for (const handle of handles.splice(0)) handle.close()
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

describe('one schema against the migration chain', () => {
  it('covers the chain through its last version', () => {
    expect(platformMigrations.at(-1)?.version).toBe(38)
  })

  it('writes the same sqlite_master, columns, indexes and foreign keys', () => {
    const chain = openDatabase('chain')
    migratePlatformDatabase(chain.db)
    const collapsed = openDatabase('collapsed')
    initializePlatformDatabase(collapsed.db)

    const chainSchema = describeSchema(chain, ['schema_migrations'])
    const collapsedSchema = describeSchema(collapsed, [])

    expect(collapsedSchema.objects.map((object) => object.name)).toEqual(
      chainSchema.objects.map((object) => object.name),
    )
    expect(collapsedSchema).toEqual(chainSchema)
    expect(collapsedSchema.objects.filter((object) => object.type === 'trigger')).toEqual([])
    expect(collapsed.db.$client.query('PRAGMA integrity_check').all()).toEqual([
      { integrity_check: 'ok' },
    ])
  })
})

type SchemaObject = { type: string; name: string; tbl_name: string; sql: string | null }

function describeSchema(handle: MetadataDatabaseHandle, excluded: readonly string[]) {
  const client = handle.db.$client
  const objects = client
    .query<SchemaObject, []>(
      'SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name',
    )
    .all()
    .filter((object) => !excluded.includes(object.tbl_name))
    .map((object) => ({ ...object, sql: normalizeSql(object.sql) }))
  const tables = objects.filter((object) => object.type === 'table').map((object) => object.name)
  const indexes = objects.filter((object) => object.type === 'index').map((object) => object.name)

  return {
    objects,
    columns: Object.fromEntries(
      tables.map((table) => [table, client.query(`PRAGMA table_xinfo("${table}")`).all()]),
    ),
    foreignKeys: Object.fromEntries(
      tables.map((table) => [table, client.query(`PRAGMA foreign_key_list("${table}")`).all()]),
    ),
    indexLists: Object.fromEntries(
      tables.map((table) => [table, client.query(`PRAGMA index_list("${table}")`).all()]),
    ),
    indexColumns: Object.fromEntries(
      indexes.map((index) => [index, client.query(`PRAGMA index_xinfo("${index}")`).all()]),
    ),
  }
}

// Whitespace is the only difference allowed: the one schema puts each column on its own line.
function normalizeSql(text: string | null) {
  if (text === null) return null
  return text
    .replace(/\s+/g, ' ')
    .replace(/\(\s/g, '(')
    .replace(/\s\)/g, ')')
    .replace(/\s,/g, ',')
    .trim()
}

function openDatabase(label: string) {
  const directory = mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', `p132-schema-${label}-`))
  directories.push(directory)
  const handle = createMetadataDatabase({ databasePath: path.join(directory, 'platform.sqlite') })
  handles.push(handle)
  return handle
}
