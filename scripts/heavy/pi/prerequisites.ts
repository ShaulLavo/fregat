/** Shell that installs whichever of git and rsync is missing; sync needs rsync on both ends. */
export function prerequisitesScript() {
  return [
    'need=',
    'command -v git >/dev/null || need="$need git"',
    'command -v rsync >/dev/null || need="$need rsync"',
    '[ -z "$need" ] || sudo -n env DEBIAN_FRONTEND=noninteractive apt-get install -y -q $need >/dev/null',
  ].join('\n')
}
