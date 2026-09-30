export function matchesOrchestrationRpc(url: URL): boolean {
  return /\/orchestration\/rpc(?:\?|$)/.test(url.href)
}
