import { dlopen } from 'bun:ffi'

export function foregroundJobGroup(): number | null {
  if (process.platform === 'win32' || !process.stdin.isTTY) return null
  const library = dlopen(
    process.platform === 'darwin' ? '/usr/lib/libSystem.B.dylib' : 'libc.so.6',
    {
      getpgrp: { args: [], returns: 'i32' },
      getsid: { args: ['i32'], returns: 'i32' },
      tcgetpgrp: { args: ['i32'], returns: 'i32' },
    },
  )
  try {
    const group = library.symbols.getpgrp()
    if (group <= 1 || library.symbols.tcgetpgrp(process.stdin.fd) !== group) return null
    if (group === library.symbols.getsid(0)) return null
    return ownsJobGroup(group) ? group : null
  } finally {
    library.close()
  }
}

// Ours when this process leads the group, or when the launcher that named itself in
// PLATFORM_TUI_LAUNCHER_PID leads it and is our parent. A shell leading the group never is.
function ownsJobGroup(group: number): boolean {
  if (group === process.pid) return true
  const launcher = Number(process.env.PLATFORM_TUI_LAUNCHER_PID)
  return group === launcher && group === process.ppid
}
