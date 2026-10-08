#!/usr/bin/env python3
"""Forced SSH command. Accept a site archive and atomically activate it."""
import fcntl
import filecmp
import os
import re
from pathlib import Path, PurePosixPath
import shutil
import resource
import signal
import sys
import tarfile
import tempfile


def extract_release(release, stream):
    size = 0
    count = 0
    with tarfile.open(fileobj=stream, mode='r|gz') as archive:
        for member in archive:
            name = PurePosixPath(member.name)
            if name.is_absolute() or '..' in name.parts:
                raise ValueError('Invalid archive path')
            if not member.isfile() and not member.isdir():
                raise ValueError('Archive must contain only files and directories')
            if name.parts and name.parts[0] not in {'index.html', 'fregat', 'singapore', 'ghostty-webgpu'}:
                raise ValueError('Unexpected site path')
            count += 1
            size += member.size
            if count > 50000 or size > 1024 * 1024 * 1024:
                raise ValueError('Archive exceeds deployment limit')
            target = release.joinpath(*name.parts)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.extractfile(member) as source, target.open('xb') as destination:
                shutil.copyfileobj(source, destination)
            target.chmod(0o644)


def retain_assets(root, release):
    for asset in release.rglob('*'):
        path = asset.relative_to(release)
        if not asset.is_file() or not re.search(r'/(?:_astro|assets)/[^/]+[.-][A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|png|jpe?g|svg|webp|wasm)$', str(path), re.I):
            continue
        retained = root / 'immutable' / path
        retained.parent.mkdir(parents=True, exist_ok=True)
        if retained.exists():
            if not filecmp.cmp(asset, retained, shallow=False):
                raise ValueError('A retained hashed asset has different content')
            continue
        os.link(asset, retained)


def publish(root, stream):
    os.umask(0o022)
    root.mkdir(parents=True, exist_ok=True)
    releases = root / 'releases'
    releases.mkdir(exist_ok=True)
    with (root / 'publish.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        release = Path(tempfile.mkdtemp(prefix='release-', dir=releases))
        try:
            extract_release(release, stream)
            indexes = ('index.html', 'fregat/index.html', 'singapore/index.html', 'ghostty-webgpu/index.html')
            if not all((release / name).is_file() for name in indexes):
                raise ValueError('Archive is missing a site index')
            retain_assets(root, release)
            release.chmod(0o755)
            pending = root / 'current.next'
            pending.unlink(missing_ok=True)
            pending.symlink_to(release.relative_to(root))
            pending.replace(root / 'current')
        except BaseException:
            shutil.rmtree(release)
            raise
        print('Activated ' + release.name)


if __name__ == '__main__':
    if os.environ.get('SSH_ORIGINAL_COMMAND') != 'publish':
        sys.exit('Only the publish command is permitted')
    resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CPU, (120, 120))
    signal.alarm(600)
    publish(Path('/srv/product-sites'), sys.stdin.buffer)
