// Type erasure keeps the source and transformed line numbers different.
type Settlement = () => Promise<void>

export async function settle(callback: Settlement) {
  await Promise.resolve()
  await callback()
}
