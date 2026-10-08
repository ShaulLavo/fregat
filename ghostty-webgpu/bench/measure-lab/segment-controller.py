import argparse
import datetime
import fcntl
import hashlib
import json
import pathlib
import re
import signal
import subprocess
import sys
import time

parser = argparse.ArgumentParser()
parser.add_argument('protocol', type=pathlib.Path)
parser.add_argument('archive', type=pathlib.Path)
parser.add_argument('--host', required=True)
parser.add_argument('--remote-root', required=True)
parser.add_argument('--prepared', required=True)
parser.add_argument('--lock', required=True)
args = parser.parse_args()
protocol_path = args.protocol.resolve()
archive = args.archive.resolve()
protocol = json.loads(protocol_path.read_text())
assert re.fullmatch(r'm2-segments-[a-z0-9-]+', protocol['id'])
assert hashlib.sha256(archive.read_bytes()).hexdigest() == protocol['archiveSha256']
remote = args.remote_root.rstrip('/') + '/m2-segments-' + protocol['archiveSha256'][:12]
prepared = args.prepared
assert pathlib.PurePosixPath(remote).is_absolute()
assert pathlib.PurePosixPath(prepared).is_absolute()
assert all(c.isalnum() or c in '/._-' for c in remote + prepared)
lifecycle = pathlib.Path(__file__).with_name('remote-segment-job.sh')
lifecycle_sha = hashlib.sha256(lifecycle.read_bytes()).hexdigest()
remote_lifecycle = remote + '/remote-job-' + lifecycle_sha[:12] + '.sh'
job = remote + '/' + protocol['id'] + '.job'
remote_protocol = remote + '/' + protocol['id'] + '.protocol.json'
local = protocol_path.parent / 'native'
local.mkdir(exist_ok=False)
started = time.monotonic()
run_exit = None
clean = False
launched = False
status = None
remote_deadline = None


def receipt(name, value):
    value['at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    (local / name).write_text(json.dumps(value, indent=2) + '\n')
    print(json.dumps(value), flush=True)


def ssh(command, timeout=15, bounded=True, **kwargs):
    remaining = 570 - (time.monotonic() - started) if bounded else timeout
    assert remaining > 0, 'Controller deadline reached'
    prefix = 'export PATH=$HOME/.local/share/mise/shims:$PATH\nset -eu\n'
    return subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', args.host, '/bin/bash', '-s'], input=prefix + command, text=True, timeout=min(timeout, remaining), **kwargs)


def copy(source, destination, timeout=30):
    subprocess.run(['scp', '-q', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', source, destination], check=True, timeout=timeout)


def interrupted(signum, frame):
    raise KeyboardInterrupt(f'Controller received signal {signum}')


signal.signal(signal.SIGTERM, interrupted)
signal.signal(signal.SIGHUP, interrupted)


def acquire():
    global launched, remote_deadline, status, run_exit
    guards = 'test ! -e "$HOME/tmp/ghostty-bench/RECLAIMED" || exit 73\ntest ! -e "$HOME/tmp/ghostty-bench/EXPERIMENT_HOLD" || exit 73\n'
    stage_probe = ssh(guards + f'test -d {remote}')
    assert stage_probe.returncode != 73, 'Owner marker stops acquisition'
    staged = stage_probe.returncode == 0
    if not staged:
        ssh(guards + f'mkdir {remote}', check=True)
        copy(str(archive), f'{args.host}:{remote}/shared.tar.gz', 60)
        ssh(guards + f'cd {remote}\ntar -xzf shared.tar.gz\n', timeout=60, check=True)
    copy(str(protocol_path), f'{args.host}:{remote_protocol}')
    copy(str(lifecycle), f'{args.host}:{remote_lifecycle}')
    ssh(guards + f'''cd {remote}
test ! -e {protocol['id']}
test ! -e {job}
test "$(shasum -a 256 shared.tar.gz | cut -d ' ' -f 1)" = {protocol['archiveSha256']}
test "$(shasum -a 256 {remote_protocol} | cut -d ' ' -f 1)" = {hashlib.sha256(protocol_path.read_bytes()).hexdigest()}
test "$(shasum -a 256 {remote_lifecycle} | cut -d ' ' -f 1)" = {lifecycle_sha}
mkdir {job}
touch {job}/heartbeat
''', check=True)
    remote_limit = min(510, int(520 - (time.monotonic() - started)))
    assert remote_limit > 0, 'Staging exhausted the acquisition budget'
    receipt('stage.json', {'remote': remote, 'protocol': protocol, 'archiveSha256': protocol['archiveSha256'], 'lifecycleSha256': lifecycle_sha, 'remoteDeadlineSeconds': remote_limit, 'heartbeatExpirySeconds': 30})
    launched = True
    remote_deadline = time.monotonic() + remote_limit + 15
    launch = ssh(guards + f'nohup /bin/bash {remote_lifecycle} {remote} {prepared} {remote_protocol} {job} {remote_limit} < /dev/null > {job}/control.log 2>&1 &\necho $!\n', capture_output=True, check=True)
    receipt('launch.json', {'managerPid': int(launch.stdout.strip()), 'job': job})
    network_errors = []
    while status is None:
        assert time.monotonic() - started < 545, 'Local acquisition deadline'
        try:
            poll = ssh(guards + f'touch {job}/heartbeat\nif test -e {job}/status.json; then cat {job}/status.json; else echo waiting; fi\n', capture_output=True, check=True)
            if poll.stdout.strip() != 'waiting':
                status = json.loads(poll.stdout)
                break
        except (subprocess.SubprocessError, ValueError) as error:
            if isinstance(error, subprocess.CalledProcessError) and error.returncode == 73:
                raise AssertionError('Owner marker stops acquisition') from error
            network_errors.append({'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'type': type(error).__name__})
        time.sleep(2)
    run_exit = status['exitCode']
    receipt('remote-status.json', status)
    receipt('poll.json', {'networkErrors': network_errors})
    ssh(f'cd {remote}\nCOPYFILE_DISABLE=1 tar -czf {protocol["id"]}.tar.gz {protocol["id"]} {protocol["id"]}.job\n', timeout=30, check=True)
    copy(f'{args.host}:{remote}/{protocol["id"]}.tar.gz', str(local / 'output.tar.gz'), 30)
    subprocess.run(['tar', '--warning=no-unknown-keyword', '-xzf', str(local / 'output.tar.gz'), '-C', str(local)], check=True, timeout=15)
    receipt('run.json', {'runExitCode': run_exit})


def finish():
    global clean, status
    if launched and status is None:
        try:
            cancel = ssh(f'touch {job}/cancel\nfor i in $(seq 1 10); do if test -e {job}/status.json; then cat {job}/status.json; exit 0; fi; sleep 1; done\nexit 1\n', timeout=15, bounded=False, capture_output=True)
            if cancel.returncode == 0:
                status = json.loads(cancel.stdout)
                receipt('remote-status.json', status)
        except (subprocess.SubprocessError, ValueError) as error:
            receipt('cancel-failure.json', {'type': type(error).__name__, 'remoteCleanup': 'Heartbeat expiry and independent deadline remain armed.'})
        if status is None:
            safe_after = min(time.monotonic() + 35, remote_deadline + 5)
            time.sleep(max(0, safe_after - time.monotonic()))
    time.sleep(.2)
    custody_script = f'''/usr/bin/python3 - <<'PY'
import os, subprocess
for row in subprocess.check_output(['/bin/ps', '-axo', 'uid=,pid=,ppid=,command='], text=True).splitlines():
    parts = row.strip().split(None, 3)
    if len(parts) == 4 and int(parts[0]) == os.getuid() and {remote!r} in parts[3]:
    print(row.strip())
PY
'''
    try:
        custody = ssh(custody_script, timeout=10, bounded=False, capture_output=True)
        clean = custody.returncode == 0 and not custody.stdout.strip()
        receipt('custody.json', {'clean': clean, 'remainingOwnedProcesses': custody.stdout.strip(), 'returnCode': custody.returncode})
    except subprocess.SubprocessError as error:
        receipt('custody.json', {'clean': False, 'failure': type(error).__name__})
    receipt('wall.json', {'wallSeconds': time.monotonic() - started, 'runExitCode': run_exit})


with open(args.lock, 'a+') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    try:
        acquire()
    finally:
        finish()
sys.exit(0 if run_exit == 0 and clean else 1)
