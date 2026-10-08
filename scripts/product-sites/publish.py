#!/usr/bin/env python3
"""Forced SSH command. Accept a site archive and atomically activate it."""
import fcntl
import filecmp
import hashlib
import os
import re
from pathlib import Path, PurePosixPath
import shutil
import resource
import signal
import sys
import tarfile
import tempfile

MAX_BYTES = 400 * 1024 * 1024
KEEP_RELEASES = 3
MAX_TREE_BYTES = 3 * 1024 * 1024 * 1024
MAX_TREE_INODES = 50000
HASHED_ASSET = re.compile(r'/(?:_astro|assets)/[^/]+[.-](?=[A-Za-z0-9_-]{8}\.)[A-Za-z0-9_-]*[0-9A-Z_][A-Za-z0-9_-]*\.(?:js|css|woff2?|png|jpe?g|svg|webp|wasm)$')


def tree_usage(root):
    seen = set()
    size = 0
    for path in (root, *root.rglob('*')):
        metadata = path.lstat()
        identity = (metadata.st_dev, metadata.st_ino)
        if identity in seen:
            continue
        seen.add(identity)
        size += max(metadata.st_size, metadata.st_blocks * 512)
    return size, len(seen)


class TreeBudget:
    def __init__(self, root):
        self.root = root
        self.size, self.inodes = tree_usage(root)
        self.block_size = max(4096, os.statvfs(root).f_frsize)
        self.reserve(0, 0)

    def reserve(self, size, inodes):
        if self.size + size > MAX_TREE_BYTES or self.inodes + inodes > MAX_TREE_INODES:
            raise ValueError('Sites tree exceeds aggregate storage limit')
        self.size += size
        self.inodes += inodes

    def directories(self, path):
        missing = 0
        while path != self.root and not path.exists():
            missing += 1
            path = path.parent
        self.reserve(missing * self.block_size * 2, missing)

    def file(self, path, size):
        self.directories(path.parent)
        blocks = (size + self.block_size - 1) // self.block_size
        self.reserve((blocks + 1) * self.block_size, 1)


def extract_release(release, stream, budget):
    size = 0
    count = 0
    with tarfile.open(fileobj=stream, mode='r|gz') as archive:
        for member in archive:
            name = PurePosixPath(member.name)
            if name.is_absolute() or '..' in name.parts or any(part.startswith('.') for part in name.parts):
                raise ValueError('Invalid archive path')
            if not member.isfile() and not member.isdir():
                raise ValueError('Archive must contain only files and directories')
            if name.parts and name.parts[0] not in {'index.html', 'fregat', 'singapore', 'ghostty-webgpu'}:
                raise ValueError('Unexpected site path')
            count += 1
            size += member.size
            if count > 50000 or size > MAX_BYTES:
                raise ValueError('Archive exceeds deployment limit')
            target = release.joinpath(*name.parts)
            if member.isdir():
                budget.directories(target)
                target.mkdir(parents=True, exist_ok=True)
                continue
            budget.file(target, member.size)
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.extractfile(member) as source, target.open('xb') as destination:
                shutil.copyfileobj(source, destination)
                destination.flush()
                os.fchmod(destination.fileno(), 0o644)
                os.fsync(destination.fileno())


def hashed_assets(release):
    return {asset.relative_to(release): asset for asset in release.rglob('*')
            if asset.is_file() and HASHED_ASSET.search(str(asset.relative_to(release)))}


def sync_directory(directory):
    descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def prune(root):
    current = (root / 'current').resolve()
    complete = sorted((path for path in (root / 'releases').glob('release-*')
                       if (path / '.complete').is_file()), key=lambda path: path.stat().st_mtime_ns, reverse=True)
    retained = [current] if current.is_dir() else []
    retained.extend(path for path in complete if path != current)
    retained = retained[:KEEP_RELEASES]
    for path in (root / 'releases').glob('release-*'):
        if path not in retained:
            shutil.rmtree(path)
    referenced = {path for release in retained for path in hashed_assets(release)}
    immutable = root / 'immutable'
    for asset in immutable.rglob('*'):
        if asset.is_file() and asset.relative_to(immutable) not in referenced:
            asset.unlink()
    for directory in sorted((path for path in immutable.rglob('*') if path.is_dir()), reverse=True):
        if not any(directory.iterdir()):
            directory.rmdir()
    return retained


def retain_assets(root, release, budget):
    assets = hashed_assets(release)
    for path, asset in assets.items():
        retained = root / 'immutable' / path
        if retained.exists() and not filecmp.cmp(asset, retained, shallow=False):
            raise ValueError('A retained hashed asset has different content')
    for path, asset in assets.items():
        retained = root / 'immutable' / path
        budget.directories(retained.parent)
        retained.parent.mkdir(parents=True, exist_ok=True)
        if not retained.exists():
            budget.reserve(budget.block_size, 0)
            os.link(asset, retained)


def release_digest(release):
    digest = hashlib.sha256()
    for path in sorted(path for path in release.rglob('*') if path.is_file() and path.name != '.complete'):
        digest.update(str(path.relative_to(release)).encode() + b'\0')
        with path.open('rb') as source:
            digest.update(hashlib.file_digest(source, 'sha256').digest())
    return digest.hexdigest()


def publish(root, stream):
    os.umask(0o022)
    root.mkdir(parents=True, exist_ok=True)
    releases = root / 'releases'
    releases.mkdir(exist_ok=True)
    with (root / 'publish.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        prune(root)
        release = Path(tempfile.mkdtemp(prefix='release-', dir=releases))
        try:
            budget = TreeBudget(root)
            budget.reserve(budget.block_size * 4, 2)
            extract_release(release, stream, budget)
            indexes = ('index.html', 'fregat/index.html', 'singapore/index.html', 'ghostty-webgpu/index.html')
            if not all((release / name).is_file() for name in indexes):
                raise ValueError('Archive is missing a site index')
            digest = release_digest(release)
            current_marker = root / 'current/.complete'
            if current_marker.is_file() and current_marker.read_text() == digest:
                shutil.rmtree(release)
                print('Unchanged site content')
                return
            retain_assets(root, release, budget)
            with (release / '.complete').open('w') as marker:
                marker.write(digest)
                marker.flush()
                os.fsync(marker.fileno())
            release.chmod(0o755)
            for directory in sorted((path for path in release.rglob('*') if path.is_dir()), reverse=True):
                sync_directory(directory)
            sync_directory(release)
            sync_directory(releases)
            immutable = root / 'immutable'
            for directory in sorted((path for path in immutable.rglob('*') if path.is_dir()), reverse=True):
                sync_directory(directory)
            if immutable.exists():
                sync_directory(immutable)
            pending = root / 'current.next'
            pending.unlink(missing_ok=True)
            pending.symlink_to(release.relative_to(root))
            TreeBudget(root)
            pending.replace(root / 'current')
            sync_directory(root)
            prune(root)
        except BaseException:
            if (root / 'current').resolve() != release:
                shutil.rmtree(release, ignore_errors=True)
                prune(root)
            raise
        print('Activated ' + release.name)


def interrupted(signum, frame):
    raise TimeoutError('Publisher interrupted by signal ' + str(signum))


def install_signal_handlers():
    for signum in (signal.SIGALRM, signal.SIGXCPU, signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
        signal.signal(signum, interrupted)


if __name__ == '__main__':
    if os.environ.get('SSH_ORIGINAL_COMMAND') != 'publish':
        sys.exit('Only the publish command is permitted')
    install_signal_handlers()
    resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CPU, (120, 130))
    signal.alarm(600)
    publish(Path('/srv/product-sites'), sys.stdin.buffer)
