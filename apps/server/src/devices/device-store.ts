import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import * as v from 'valibot'

const deviceRecordSchema = v.object({
  id: v.string(),
  label: v.string(),
  /** SHA-256 of the device's secret, hex. The secret itself lives only in the device's cookie. */
  secretHash: v.string(),
  pairedAt: v.string(),
  lastSeenAt: v.string(),
})
const deviceFileSchema = v.object({ devices: v.array(deviceRecordSchema) })

export type DeviceRecord = v.InferOutput<typeof deviceRecordSchema>

/**
 * Paired devices, in a JSON file beside the database rather than a table in it: a new table would
 * bump the schema version, and that resets every session. Mode 0600, like the secret store.
 */
export class DeviceStore {
  private readonly filePath: string
  private devices: DeviceRecord[] | null = null

  constructor(filePath: string) {
    this.filePath = filePath
  }

  list(): readonly DeviceRecord[] {
    this.devices ??= this.read()
    return this.devices
  }

  get(id: string) {
    return this.list().find((device) => device.id === id)
  }

  add(device: DeviceRecord) {
    this.write(this.list().concat([device]))
  }

  remove(id: string) {
    const devices = this.list()
    const kept = devices.filter((device) => device.id !== id)
    if (kept.length === devices.length) return false
    this.write(kept)
    return true
  }

  touch(id: string, lastSeenAt: string) {
    this.write(this.list().map((device) => (device.id === id ? { ...device, lastSeenAt } : device)))
  }

  private read(): DeviceRecord[] {
    if (!existsSync(this.filePath)) return []
    const parsed = v.safeParse(deviceFileSchema, JSON.parse(readFileSync(this.filePath, 'utf8')))
    // An unreadable file pairs nothing: every device pairs again, and nothing is let in by mistake.
    return parsed.success ? parsed.output.devices : []
  }

  private write(devices: DeviceRecord[]) {
    mkdirSync(path.dirname(this.filePath), { recursive: true })
    const staged = `${this.filePath}.${process.pid}.tmp`
    writeFileSync(staged, `${JSON.stringify({ devices }, null, 2)}\n`, { mode: 0o600 })
    chmodSync(staged, 0o600)
    renameSync(staged, this.filePath)
    this.devices = devices
  }
}
