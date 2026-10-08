import gzip
import io
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

from publish import publish


def archive(extra=None, omit=None):
    data = io.BytesIO()
    with tarfile.open(fileobj=data, mode='w:gz') as output:
        for name in ('index.html', 'fregat/index.html', 'singapore/index.html', 'ghostty-webgpu/index.html'):
            if name == omit:
                continue
            member = tarfile.TarInfo(name)
            member.size = 2
            output.addfile(member, io.BytesIO(b'ok'))
        if extra:
            member, content = extra
            output.addfile(member, io.BytesIO(content))
    data.seek(0)
    return data


class PublishTests(unittest.TestCase):
    def test_repeat_publish_changes_complete_release(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            publish(root, archive())
            previous = (root / 'current').resolve()
            publish(root, archive())
            self.assertNotEqual(previous, (root / 'current').resolve())
            self.assertEqual((root / 'current/fregat/index.html').read_text(), 'ok')
            self.assertEqual(previous.joinpath('index.html').read_text(), 'ok')

    def test_invalid_archives_leave_active_release_unchanged(self):
        link = tarfile.TarInfo('fregat/link')
        link.type = tarfile.SYMTYPE
        link.linkname = '/etc/passwd'
        oversized = tarfile.TarInfo('fregat/large')
        oversized.size = 1024 * 1024 * 1024 + 1
        cases = [
            io.BytesIO(gzip.compress(oversized.tobuf() + b'\0' * 1024)),
            archive((tarfile.TarInfo('../escape'), b'')),
            archive((tarfile.TarInfo('/absolute'), b'')),
            archive((tarfile.TarInfo('unexpected'), b'')),
            archive((link, b'')),
            archive(omit='singapore/index.html'),
            archive((tarfile.TarInfo('fregat/index.html'), b'')),
            io.BytesIO(b'invalid gzip'),
        ]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            publish(root, archive())
            previous = (root / 'current').resolve()
            for data in cases:
                with self.subTest(data=data), self.assertRaises((ValueError, OSError, tarfile.TarError)):
                    publish(root, data)
                self.assertEqual(previous, (root / 'current').resolve())
                self.assertEqual(len(list((root / 'releases').iterdir())), 1)

    def test_old_hashed_assets_survive_publication(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            member = tarfile.TarInfo('fregat/assets/main-12345678.js')
            member.size = 2
            publish(root, archive((member, b'ok')))
            publish(root, archive())
            self.assertFalse((root / 'current/fregat/assets/main-12345678.js').exists())
            self.assertEqual((root / 'immutable/fregat/assets/main-12345678.js').read_text(), 'ok')

    def test_conflicting_hashed_asset_keeps_active_release(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            member = tarfile.TarInfo('fregat/assets/main-12345678.js')
            member.size = 2
            publish(root, archive((member, b'ok')))
            previous = (root / 'current').resolve()
            with self.assertRaises(ValueError):
                publish(root, archive((member, b'no')))
            self.assertEqual(previous, (root / 'current').resolve())

    def test_closed_ssh_output_keeps_activated_release(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch('builtins.print', side_effect=BrokenPipeError), self.assertRaises(BrokenPipeError):
                publish(root, archive())
            self.assertEqual((root / 'current/index.html').read_text(), 'ok')

    def test_forced_command_rejects_shell(self):
        result = subprocess.run(
            [sys.executable, str(Path(__file__).with_name('publish.py'))],
            env={**os.environ, 'SSH_ORIGINAL_COMMAND': 'sh'},
            capture_output=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b'Only the publish command', result.stderr)


if __name__ == '__main__':
    unittest.main()
