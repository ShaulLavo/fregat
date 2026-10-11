export function runLiveProcess(
  file: string,
  args: readonly string[],
  options?: {
    signal?: AbortSignal
    timeout?: number
    cleanupTimeout?: number
    maxBuffer?: number
  },
): Promise<{ stdout: string; stderr: string }>
