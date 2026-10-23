#!/usr/bin/env bash
set -x
uname -a; systemctl --version | head -2; cat /proc/self/cgroup; cat /proc/cgroups; mount | grep -i cgroup
cat /proc/self/oom_score_adj; free -m; swapon --show; cat /proc/sys/kernel/core_pattern; cat /proc/sys/vm/overcommit_memory
systemctl --user is-system-running; u=$(id -u)
cat /sys/fs/cgroup/user.slice/user-$u.slice/user@$u.service/cgroup.subtree_control
cat /sys/fs/cgroup/user.slice/user-$u.slice/user@$u.service/app.slice/cgroup.subtree_control
systemctl show user@$u.service -p Delegate -p DelegateControllers
for v in 1.4.2 1.4.4; do
  PATH="$HOME/bun-$v/bin:$PATH" bun --version
  PATH="$HOME/bun-$v/bin:$PATH" bun -e 'console.log("constrainedMemory", process.constrainedMemory(), require("os").availableParallelism())'
  PATH="$HOME/bun-$v/bin:$PATH" bun .github/case-scope-diag/probe.ts
  echo "=== dmesg after $v"; sudo dmesg | grep -iE 'oom|killed process|Memory cgroup' | tail -40
  sudo dmesg -C
done
journalctl --user --no-pager -n 200 | grep -iE 'diag-|oom' | tail -80
