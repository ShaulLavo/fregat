import { describe, expect, it } from 'vitest'

import { parseLinuxMounts } from '../drives'

describe('drives', () => {
  it('keeps one mount per device and drops the ones the OS keeps for itself', () => {
    const table = [
      '/dev/mapper/root / btrfs rw,subvol=/@ 0 0',
      '/dev/mapper/root /var/log btrfs rw,subvol=/@log 0 0',
      '/dev/nvme1n1p1 /boot vfat rw 0 0',
      '/dev/mapper/data_crypt /data xfs rw 0 0',
      '/dev/mapper/data_crypt /home xfs rw 0 0',
      '/dev/mapper/vgwork-work /work xfs rw 0 0',
      '/dev/sdc1 /run/media/me/USB\\040Stick ntfs3 rw 0 0',
      '/dev/loop0 /snap/core/1 squashfs ro 0 0',
      'tmpfs /tmp tmpfs rw 0 0',
    ].join('\n')

    expect(parseLinuxMounts(table).map(({ label, mountPoint }) => [label, mountPoint])).toEqual([
      ['System', '/'],
      ['data', '/data'],
      ['USB Stick', '/run/media/me/USB Stick'],
      ['work', '/work'],
    ])
  })
})
