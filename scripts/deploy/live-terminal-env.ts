import path from 'node:path'

export function liveTerminalEnv(
  home: string,
  shell: string,
  inherited = process.env,
): NodeJS.ProcessEnv {
  return {
    HOME: home,
    SHELL: shell,
    PATH: inherited.PATH,
    LANG: inherited.LANG,
    LC_ALL: inherited.LC_ALL,
    PS1: 'fregat-live-check$ ',
    HISTFILE: path.join(home, 'history'),
    TMPDIR: home,
  }
}
