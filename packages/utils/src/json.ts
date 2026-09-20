import { isRecord } from './objects'

export type JsonValue = boolean | null | number | string | JsonObject | JsonValue[]
export type JsonObject = { [key: string]: JsonValue }

// The parser establishes JSON values; this narrows the container shape.
export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return isRecord(value)
}
