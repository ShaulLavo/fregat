export function matchesOrchestrationRpc(url: URL): boolean {
  return url.pathname.endsWith('/orchestration/rpc')
}
