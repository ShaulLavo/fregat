import { createScriptError } from '../structured-errors'
import type { BenchmarkSample, BenchmarkUnit } from './bench-types'
import { BENCHMARK_FAMILIES, type BenchmarkFamily } from './workloads'

export function parseBrowserBenchmarkLog(log: string): BenchmarkSample[] {
  const marker = 'MARKDOWN_BROWSER_METRIC '
  return log
    .split('\n')
    .filter((line) => line.includes(marker))
    .map((line) => {
      const start = line.indexOf(marker) + marker.length
      const value: unknown = JSON.parse(line.slice(start).trim())
      return parseRecord(value)
    })
}

function parseRecord(value: unknown): BenchmarkSample {
  if (!value || typeof value !== 'object') throw invalidRecord('record')
  if (!('family' in value) || !isFamily(value.family)) throw invalidRecord('family')
  if (!('fixture' in value) || typeof value.fixture !== 'string' || value.fixture.length === 0)
    throw invalidRecord('fixture')
  const revision = readCount(value, 'revision')
  if (!('field' in value) || typeof value.field !== 'string' || value.field.length === 0)
    throw invalidRecord('field')
  if (!('sample' in value) || typeof value.sample !== 'number' || !Number.isFinite(value.sample))
    throw invalidRecord('sample')
  if (!('unit' in value) || !isUnit(value.unit)) throw invalidRecord('unit')
  const sourceBytes = readCount(value, 'sourceBytes')
  if (!('outputMatches' in value) || typeof value.outputMatches !== 'boolean')
    throw invalidRecord('outputMatches')
  if (!('build' in value) || !isBuild(value.build)) throw invalidRecord('build')
  if (!('engine' in value) || value.engine !== 'remark') throw invalidRecord('engine')
  const trial = readCount(value, 'trial')
  if (!('cacheState' in value) || typeof value.cacheState !== 'string')
    throw invalidRecord('cacheState')
  return {
    family: value.family,
    fixture: value.fixture,
    revision,
    field: value.field,
    sample: value.sample,
    unit: value.unit,
    sourceBytes,
    outputMatches: value.outputMatches,
    build: value.build,
    engine: value.engine,
    trial,
    cacheState: value.cacheState,
    domain: 'browser',
  }
}

function isFamily(value: unknown): value is BenchmarkFamily {
  return typeof value === 'string' && BENCHMARK_FAMILIES.some((family) => family === value)
}

function isUnit(value: unknown): value is BenchmarkUnit {
  return value === 'ms' || value === 'bytes' || value === 'count'
}

function isBuild(value: unknown): value is BenchmarkSample['build'] {
  return value === 'development' || value === 'production'
}

function readCount(record: object, field: string): number {
  const value: unknown = Reflect.get(record, field)
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw invalidRecord(field)
  return value
}

function invalidRecord(field: string) {
  return createScriptError('Browser benchmark log contains an invalid metric', {
    internal: { field },
  })
}
