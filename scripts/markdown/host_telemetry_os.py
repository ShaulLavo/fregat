"""Native cumulative counters for launch-scoped host telemetry."""

from __future__ import annotations

import ctypes
import errno
import os
import platform
import subprocess
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass(frozen=True)
class ProcessCounter:
    pid: int
    parent_pid: int
    group: int
    started: int
    cpu_ns: int
    live: bool = True

    @property
    def identity(self) -> tuple[int, int]:
        return self.pid, self.started


@dataclass(frozen=True)
class Snapshot:
    monotonic_ns: int
    cpu_started_ns: int
    cpu_resolution_ns: int
    process_clock: int
    cpu_completed_ns: int
    capacity_ns: int
    busy_ns: int
    logical_cpus: int
    load_average: tuple[float, float, float]
    processes: tuple[ProcessCounter, ...]
    unreadable_pids: tuple[int, ...]

    def record(self) -> dict:
        return asdict(self)


def command_text(command: list[str]) -> str:
    return subprocess.check_output(command, text=True, timeout=1).strip()


def host_identity() -> dict:
    if sys.platform == "darwin":
        hardware = command_text(["/usr/sbin/sysctl", "-n", "machdep.cpu.brand_string"])
        memory = int(command_text(["/usr/sbin/sysctl", "-n", "hw.memsize"]))
    elif sys.platform == "linux":
        hardware = linux_hardware()
        memory = os.sysconf("SC_PHYS_PAGES") * os.sysconf("SC_PAGE_SIZE")
    else:
        raise RuntimeError(f"Unsupported native telemetry platform: {sys.platform}")
    architecture = {"x86_64": "x64", "aarch64": "arm64", "arm64": "arm64"}.get(
        platform.machine()
    )
    if not architecture or not hardware or memory <= 0:
        raise RuntimeError("Native host identity is incomplete")
    return {
        "host": platform.node(),
        "platform": sys.platform,
        "architecture": architecture,
        "hardware": hardware,
        "osRelease": platform.release(),
        "memoryBytes": memory,
    }


def linux_hardware() -> str:
    for line in Path("/proc/cpuinfo").read_text().splitlines():
        if line.startswith("model name"):
            return line.partition(":")[2].strip()
    raise RuntimeError("CPU model is unavailable from /proc/cpuinfo")


def linux_process(pid: int, ticks: int) -> ProcessCounter:
    fields = Path(f"/proc/{pid}/stat").read_text().rpartition(") ")[2].split()
    return ProcessCounter(
        pid,
        int(fields[1]),
        int(fields[2]),
        int(fields[19]),
        (int(fields[11]) + int(fields[12])) * 1_000_000_000 // ticks,
        fields[0] not in ("Z", "X"),
    )


def linux_snapshot() -> Snapshot:
    ticks = os.sysconf("SC_CLK_TCK")
    cpu_started = time.monotonic_ns()
    process_clock = time.clock_gettime_ns(time.CLOCK_BOOTTIME) * ticks // 1_000_000_000
    fields = Path("/proc/stat").read_text().splitlines()[0].split()
    counters = [int(value) for value in fields[1:9]]
    if fields[0] != "cpu" or len(counters) != 8:
        raise RuntimeError("Machine CPU counters are incomplete")
    capacity = sum(counters) * 1_000_000_000 // ticks
    busy = (sum(counters) - counters[3] - counters[4]) * 1_000_000_000 // ticks
    cpu_completed = time.monotonic_ns()
    processes, unreadable = [], []
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        read_linux_process(int(entry.name), ticks, processes, unreadable)
    return Snapshot(
        time.monotonic_ns(),
        cpu_started,
        1_000_000_000 // ticks,
        process_clock,
        cpu_completed,
        capacity,
        busy,
        os.cpu_count() or 0,
        os.getloadavg(),
        tuple(processes),
        tuple(unreadable),
    )


def read_linux_process(pid: int, ticks: int, processes: list, unreadable: list) -> None:
    try:
        processes.append(linux_process(pid, ticks))
    except (FileNotFoundError, ProcessLookupError):
        return
    except PermissionError:
        unreadable.append(pid)


class RUsageInfoV2(ctypes.Structure):
    _fields_ = [("uuid", ctypes.c_ubyte * 16)] + [
        (name, ctypes.c_uint64)
        for name in (
            "user_time",
            "system_time",
            "pkg_idle_wkups",
            "interrupt_wkups",
            "pageins",
            "wired_size",
            "resident_size",
            "phys_footprint",
            "proc_start_abstime",
            "proc_exit_abstime",
            "child_user_time",
            "child_system_time",
            "child_pkg_idle_wkups",
            "child_interrupt_wkups",
            "child_pageins",
            "child_elapsed_abstime",
            "diskio_bytesread",
            "diskio_byteswritten",
        )
    ]


class Timebase(ctypes.Structure):
    _fields_ = [("numer", ctypes.c_uint), ("denom", ctypes.c_uint)]


def darwin_libraries() -> tuple:
    system = ctypes.CDLL("/usr/lib/libSystem.B.dylib", use_errno=True)
    proc = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True)
    system.mach_absolute_time.restype = ctypes.c_uint64
    system.mach_host_self.restype = ctypes.c_uint
    system.host_processor_info.argtypes = [
        ctypes.c_uint,
        ctypes.c_int,
        ctypes.POINTER(ctypes.c_uint),
        ctypes.POINTER(ctypes.POINTER(ctypes.c_uint)),
        ctypes.POINTER(ctypes.c_uint),
    ]
    system.mach_timebase_info.argtypes = [ctypes.POINTER(Timebase)]
    system.mach_port_deallocate.argtypes = [ctypes.c_uint, ctypes.c_uint]
    system.vm_deallocate.argtypes = [ctypes.c_uint, ctypes.c_size_t, ctypes.c_size_t]
    proc.proc_pid_rusage.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
    return system, proc


def darwin_cpu(system) -> tuple[int, int]:
    counters = ctypes.POINTER(ctypes.c_uint)()
    count, cpus = ctypes.c_uint(), ctypes.c_uint()
    host = system.mach_host_self()
    task = ctypes.c_uint.in_dll(system, "mach_task_self_").value
    try:
        status = system.host_processor_info(
            host, 2, ctypes.byref(cpus), ctypes.byref(counters), ctypes.byref(count)
        )
        if status != 0 or count.value != cpus.value * 4 or cpus.value != os.cpu_count():
            raise RuntimeError(
                f"host_processor_info failed or changed CPU count: {status}"
            )
        ticks = os.sysconf("SC_CLK_TCK")
        total = sum(counters[index] for index in range(count.value))
        idle = sum(counters[index] for index in range(2, count.value, 4))
        return total * 1_000_000_000 // ticks, (total - idle) * 1_000_000_000 // ticks
    finally:
        release_darwin_cpu(system, task, host, counters, count.value)


def release_darwin_cpu(system, task, host, counters, count) -> None:
    allocation_status = 0
    if counters:
        address = ctypes.cast(counters, ctypes.c_void_p).value
        allocation_status = system.vm_deallocate(
            task, address, count * ctypes.sizeof(ctypes.c_uint)
        )
    port_status = system.mach_port_deallocate(task, host)
    if allocation_status or port_status:
        raise RuntimeError("Mach CPU observation resources could not be released")


def darwin_timebase(system) -> Timebase:
    ratio = Timebase()
    status = system.mach_timebase_info(ctypes.byref(ratio))
    if status != 0 or ratio.denom == 0 or ratio.numer == 0:
        raise RuntimeError("Mach time conversion is unavailable")
    return ratio


def read_darwin_process(
    proc, ratio: Timebase, row: str, processes: list, unreadable: list
) -> None:
    pid, parent, group = map(int, row.split())
    if pid == 0:
        return
    usage = RUsageInfoV2()
    if proc.proc_pid_rusage(pid, 2, ctypes.byref(usage)) == 0:
        processes.append(
            ProcessCounter(
                pid,
                parent,
                group,
                usage.proc_start_abstime,
                (usage.user_time + usage.system_time) * ratio.numer // ratio.denom,
                usage.proc_exit_abstime == 0,
            )
        )
        return
    code = ctypes.get_errno()
    if code == errno.ESRCH:
        return
    if code in (errno.EPERM, errno.EACCES):
        unreadable.append(pid)
        return
    raise OSError(code, "proc_pid_rusage failed")


def darwin_snapshot() -> Snapshot:
    system, proc = darwin_libraries()
    cpu_started = time.monotonic_ns()
    process_clock = system.mach_absolute_time()
    capacity, busy = darwin_cpu(system)
    cpu_completed = time.monotonic_ns()
    ratio = darwin_timebase(system)
    rows = command_text(["ps", "-axo", "pid=,ppid=,pgid="])
    processes, unreadable = [], []
    for row in rows.splitlines():
        read_darwin_process(proc, ratio, row, processes, unreadable)
    return Snapshot(
        time.monotonic_ns(),
        cpu_started,
        1_000_000_000 // os.sysconf("SC_CLK_TCK"),
        process_clock,
        cpu_completed,
        capacity,
        busy,
        os.cpu_count() or 0,
        os.getloadavg(),
        tuple(processes),
        tuple(unreadable),
    )


def snapshot() -> Snapshot:
    if sys.platform == "linux":
        return linux_snapshot()
    if sys.platform == "darwin":
        return darwin_snapshot()
    raise RuntimeError(f"Unsupported native telemetry platform: {sys.platform}")


def cpu_interval(
    before: Snapshot, after: Snapshot, owned: set[tuple[int, int]]
) -> dict:
    capacity = after.capacity_ns - before.capacity_ns
    busy = after.busy_ns - before.busy_ns
    if capacity <= 0 or busy < 0 or before.logical_cpus != after.logical_cpus:
        raise RuntimeError("Machine CPU counters changed discontinuously")
    earlier = {process.identity: process for process in before.processes}
    deltas = [
        owned_delta(process, earlier, before.process_clock)
        for process in after.processes
        if process.identity in owned
    ]
    if any(delta < 0 for delta in deltas):
        raise RuntimeError("Owned process CPU counter moved backwards")
    # Sequential reads and tick rounding can extend owned deltas past the machine interval.
    skew_ns = (
        after.monotonic_ns
        - after.cpu_started_ns
        + before.cpu_completed_ns
        - before.cpu_started_ns
    ) * after.logical_cpus
    rounding_ns = (
        2 * max(before.cpu_resolution_ns, after.cpu_resolution_ns) * len(deltas)
    )
    owned_ns = min(busy, max(0, sum(deltas) - skew_ns - rounding_ns))
    return {
        "capacityNs": capacity,
        "busyNs": busy,
        "ownedCpuNs": owned_ns,
        "attributionUncertaintyNs": skew_ns + rounding_ns,
        "competingCpuPercent": max(0, busy - owned_ns) / capacity * 100,
    }


def owned_delta(process: ProcessCounter, earlier: dict, process_clock: int) -> int:
    previous = earlier.get(process.identity)
    if previous is not None:
        return process.cpu_ns - previous.cpu_ns
    if process.started > process_clock:
        return process.cpu_ns
    return 0


def capture_identities(
    current: Snapshot, group: int, known: set[tuple[int, int]]
) -> set:
    children: dict[int, list[ProcessCounter]] = {}
    roots = [p for p in current.processes if p.group == group or p.identity in known]
    for process in current.processes:
        children.setdefault(process.parent_pid, []).append(process)
    identities = set()
    while roots:
        process = roots.pop()
        if process.identity in identities:
            continue
        identities.add(process.identity)
        roots.extend(children.get(process.pid, []))
    return identities
