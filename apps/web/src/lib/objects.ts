/**
 * Returns a shallow copy of `values` with every `null` or `undefined` entry
 * removed. Useful for building request bodies where a key should be absent
 * rather than sent as an explicit null/undefined.
 */
export function omitNullish<T extends object>(values: T): { [K in keyof T]?: NonNullable<T[K]> } {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined && value !== null),
  ) as { [K in keyof T]?: NonNullable<T[K]> }
}

/*
 * No `omitKey` here on purpose. Two record-minus-one-key helpers remain in
 * the app (`features/editor/state/workspace-document-service.ts`,
 * `features/editor/state/conflict-state.tsx`). Both return the *same object
 * identity* when the key is absent, and store subscribers depend on that.
 * A third in the rail order store always allocated; plan 113 replaced that
 * store with an intent queue. Unifying the two needs a test per call site.
 *
 * A fourth lived in the generic record widget until plan 042 deleted it.
 */
