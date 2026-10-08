import gzip
import io
import os
from pathlib import Path
import signal
import time
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

from publish import MAX_BYTES, KEEP_RELEASES, HASHED_ASSET, TreeBudget, evict_rollbacks, tree_usage, publish


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
            publish(root, archive((tarfile.TarInfo('fregat/new'), b'')))
            self.assertNotEqual(previous, (root / 'current').resolve())
            self.assertEqual((root / 'current/fregat/index.html').read_text(), 'ok')
            self.assertEqual(previous.joinpath('index.html').read_text(), 'ok')

    def test_invalid_archives_leave_active_release_unchanged(self):
        link = tarfile.TarInfo('fregat/link')
        link.type = tarfile.SYMTYPE
        link.linkname = '/etc/passwd'
        oversized = tarfile.TarInfo('fregat/large')
        oversized.size = MAX_BYTES + 1
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

    def test_identical_publish_skips_activation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            publish(root, archive())
            previous = (root / 'current').resolve()
            publish(root, archive())
            self.assertEqual(previous, (root / 'current').resolve())
            self.assertEqual(len(list((root / 'releases').iterdir())), 1)

    def test_release_and_asset_retention_is_bounded(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for index in range(KEEP_RELEASES + 2):
                member = tarfile.TarInfo(f'fregat/assets/main-{index:08d}.js')
                member.size = 2
                publish(root, archive((member, b'ok')))
            releases = list((root / 'releases').iterdir())
            self.assertEqual(len(releases), KEEP_RELEASES)
            self.assertIn((root / 'current').resolve(), releases)
            assets = list((root / 'immutable').rglob('*.js'))
            self.assertEqual(len(assets), KEEP_RELEASES)
            self.assertFalse((root / 'immutable/fregat/assets/main-00000000.js').exists())

    def test_hash_pattern_excludes_plain_names(self):
        for name in ('tree-sitter-typescript.wasm', 'name-abcdefgh.js', 'name-123456789.js'):
            self.assertIsNone(HASHED_ASSET.search('fregat/assets/' + name))
        for name in ('index-C5I7v8bI.js', 'index.BAMHfXoq.css', 'main-12345678.js'):
            self.assertIsNotNone(HASHED_ASSET.search('fregat/assets/' + name))

    def test_dotfiles_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                publish(Path(directory), archive((tarfile.TarInfo('fregat/.secret'), b'')))

    def test_interrupted_upload_cleanup_and_next_publish_sweep(self):
        module = str(Path(__file__).parent)
        for signum in (signal.SIGALRM, signal.SIGXCPU, signal.SIGKILL):
            with self.subTest(signum=signum), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                publish(root, archive())
                previous = (root / 'current').resolve()
                script = f"import sys; sys.path.insert(0, {module!r}); from publish import *; install_signal_handlers(); publish(Path({directory!r}), sys.stdin.buffer)"
                child = subprocess.Popen([sys.executable, '-c', script], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                try:
                    member = tarfile.TarInfo('fregat/large')
                    member.size = 2 * 1024 * 1024
                    data = archive((member, os.urandom(member.size))).getvalue()
                    child.stdin.write(data[:1024 * 1024])
                    child.stdin.flush()
                    deadline = time.monotonic() + 10
                    while not any(path.stat().st_size > 0 for path in (root / 'releases').glob('*/fregat/large')):
                        if time.monotonic() > deadline:
                            self.fail('Child did not start extracting upload')
                        time.sleep(0.01)
                    child.send_signal(signum)
                    child.communicate(timeout=10)
                    self.assertNotEqual(child.returncode, 0)
                    self.assertEqual(previous, (root / 'current').resolve())
                    if signum != signal.SIGKILL:
                        self.assertEqual(len(list((root / 'releases').iterdir())), 1)
                    publish(root, archive())
                    self.assertEqual(len(list((root / 'releases').iterdir())), 1)
                finally:
                    if child.poll() is None:
                        child.kill()
                        child.communicate()

    def test_files_are_synced_before_activation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = os.fsync
            states = []
            def observe(descriptor):
                states.append((root / 'current').exists())
                original(descriptor)
            with patch('publish.os.fsync', side_effect=observe):
                publish(root, archive())
            self.assertGreaterEqual(states.count(False), 5)
            self.assertTrue(states[-1])

    def test_signal_at_activation_never_deletes_active_release(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = Path.replace
            def interrupt_after_switch(path, target):
                original(path, target)
                raise TimeoutError('Signal after atomic switch')
            with patch('publish.Path.replace', interrupt_after_switch), self.assertRaises(TimeoutError):
                publish(root, archive())
            self.assertEqual((root / 'current/index.html').read_text(), 'ok')

    def test_failed_retention_removes_unreferenced_links(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            member = tarfile.TarInfo('fregat/assets/main-12345678.js')
            member.size = 2
            original = os.link
            def fail_after_link(source, target):
                original(source, target)
                raise OSError('Interrupted retention')
            with patch('publish.os.link', fail_after_link), self.assertRaises(OSError):
                publish(root, archive((member, b'ok')))
            self.assertFalse(list((root / 'immutable').rglob('*.js')))
            self.assertFalse(list((root / 'releases').iterdir()))

    def test_aggregate_byte_limit_refuses_upload_without_switch(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            publish(root, archive())
            previous = (root / 'current').resolve()
            size, _ = tree_usage(root)
            member = tarfile.TarInfo('fregat/payload')
            member.size = 256 * 1024
            with patch('publish.MAX_TREE_BYTES', size + 128 * 1024), self.assertRaisesRegex(ValueError, 'aggregate'):
                publish(root, archive((member, b'x' * member.size)))
            self.assertEqual(previous, (root / 'current').resolve())
            self.assertLessEqual(tree_usage(root)[0], size + 128 * 1024)
            self.assertEqual(len(list((root / 'releases').iterdir())), 1)

    def test_aggregate_inode_limit_refuses_upload_without_switch(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            publish(root, archive())
            previous = (root / 'current').resolve()
            _, inodes = tree_usage(root)
            with patch('publish.MAX_TREE_INODES', inodes + 10), self.assertRaisesRegex(ValueError, 'aggregate'):
                publish(root, archive((tarfile.TarInfo('fregat/a/b/c/d/e/f/g/file'), b'')))
            self.assertEqual(previous, (root / 'current').resolve())
            self.assertEqual(tree_usage(root)[1], inodes)
            self.assertEqual(len(list((root / 'releases').iterdir())), 1)

    def test_aggregate_counts_hardlinks_once_and_does_not_follow_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'asset'
            source.write_bytes(b'x' * (1024 * 1024))
            size, inodes = tree_usage(root)
            os.link(source, root / 'retained')
            after_size, after_inodes = tree_usage(root)
            self.assertEqual(after_inodes, inodes)
            self.assertLess(after_size - size, 4096)
            (root / 'loop').symlink_to(root)
            self.assertEqual(tree_usage(root)[1], inodes + 1)

    def test_budget_pressure_evicts_rollbacks_and_finishes_upload(self):
        for constraint in ('MAX_TREE_BYTES', 'MAX_TREE_INODES'):
            with self.subTest(constraint=constraint), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                for index in range(3):
                    member = tarfile.TarInfo(f'fregat/assets/main-{index:08d}.js')
                    member.size = 64 * 1024
                    publish(root, archive((member, bytes([index]) * member.size)))
                previous = (root / 'current').resolve()
                size, inodes = tree_usage(root)
                limit = size + 32 * 1024 if constraint == 'MAX_TREE_BYTES' else inodes + 3
                member = tarfile.TarInfo('fregat/assets/main-98765432.js')
                member.size = 64 * 1024
                with patch('publish.' + constraint, limit), patch('publish.evict_rollbacks', wraps=evict_rollbacks) as evict:
                    publish(root, archive((member, b'x' * member.size)))
                self.assertEqual(evict.call_count, 1)
                self.assertNotEqual(previous, (root / 'current').resolve())
                self.assertTrue(previous.exists())
                self.assertEqual(len(list((root / 'releases').iterdir())), 2)
                self.assertFalse((root / 'immutable/fregat/assets/main-00000000.js').exists())

    def test_budget_retries_eviction_only_once(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            publish(root, archive())
            budget = TreeBudget(root)
            with patch('publish.evict_rollbacks', wraps=evict_rollbacks) as evict:
                for _ in range(2):
                    with self.assertRaisesRegex(ValueError, 'aggregate'):
                        budget.reserve(4 * 1024 * 1024 * 1024, 0)
            self.assertEqual(evict.call_count, 1)
            self.assertTrue((root / 'current/index.html').exists())

    def test_symlinked_root_preserves_active_release_after_switch_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            root = parent / 'sites'
            root.mkdir()
            alias = parent / 'alias'
            alias.symlink_to(root, target_is_directory=True)
            original = Path.replace
            def interrupt_after_switch(path, target):
                original(path, target)
                raise TimeoutError('Signal after atomic switch')
            with patch('publish.Path.replace', interrupt_after_switch), self.assertRaises(TimeoutError):
                publish(alias, archive())
            self.assertEqual((alias / 'current/index.html').read_text(), 'ok')

    def test_symlinked_root_preserves_old_current_during_pruning(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            root = parent / 'sites'
            root.mkdir()
            alias = parent / 'alias'
            alias.symlink_to(root, target_is_directory=True)
            publish(alias, archive())
            previous = (alias / 'current').resolve()
            for index in range(2):
                publish(alias, archive((tarfile.TarInfo(f'fregat/{index}'), b'')))
            (root / 'current').unlink()
            (root / 'current').symlink_to(previous.relative_to(root))
            publish(alias, archive())
            self.assertEqual((alias / 'current').resolve(), previous)
            self.assertTrue(previous.exists())

    def test_admin_import_with_bytecode_disabled_leaves_no_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = Path(__file__).with_name('publish.py').read_bytes()
            (root / 'publish.py').write_bytes(source)
            result = subprocess.run([sys.executable, '-B', '-c', 'import publish'], cwd=root, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse((root / '__pycache__').exists())

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
