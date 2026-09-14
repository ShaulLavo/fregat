function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(String(key)) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(String(key))
    },
    setItem: (key, value) => {
      values.set(String(key), String(value))
    },
  }
}

export function isolateDemoStorage(): void {
  // Separate frames share origin storage; a reload should reset only this demo.
  Object.defineProperty(window, 'localStorage', { value: memoryStorage() })
  Object.defineProperty(window, 'sessionStorage', { value: memoryStorage() })
}
