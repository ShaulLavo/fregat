#define _GNU_SOURCE
#include <node_api.h>
#include <linux/perf_event.h>
#include <sys/syscall.h>
#include <sys/ioctl.h>
#include <sched.h>
#include <unistd.h>
#include <errno.h>
#include <stdio.h>
#include <stdint.h>
#include <string.h>

static int leader = -1;
static int cycles = -1;
static uint64_t previous_enabled = 0;
static uint64_t previous_running = 0;

static napi_value failure(napi_env env, const char *operation) {
  char message[256];
  snprintf(message, sizeof(message), "%s failed: errno=%d (%s)", operation, errno, strerror(errno));
  napi_throw_error(env, "PERF_COUNTER", message);
  return NULL;
}

static int event(uint64_t config, int group) {
  struct perf_event_attr attr = {0};
  attr.size = sizeof(attr);
  attr.type = PERF_TYPE_HARDWARE;
  attr.config = config;
  attr.disabled = 1;
  attr.exclude_kernel = 1;
  attr.exclude_hv = 1;
  attr.read_format = PERF_FORMAT_GROUP | PERF_FORMAT_TOTAL_TIME_ENABLED | PERF_FORMAT_TOTAL_TIME_RUNNING;
  return syscall(__NR_perf_event_open, &attr, 0, -1, group, PERF_FLAG_FD_CLOEXEC);
}

static napi_value open_counters(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  uint32_t type = 0;
  int32_t cpu = -1;
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  if (argc > 0) napi_get_value_uint32(env, args[0], &type);
  if (argc > 1) napi_get_value_int32(env, args[1], &cpu);
  if (leader >= 0) { errno = EALREADY; return failure(env, "counter already open"); }
  if (cpu < -1 || cpu >= CPU_SETSIZE) { errno = EINVAL; return failure(env, "CPU affinity range"); }
  if (cpu >= 0) {
    cpu_set_t mask;
    CPU_ZERO(&mask);
    CPU_SET(cpu, &mask);
    if (sched_setaffinity(0, sizeof(mask), &mask)) return failure(env, "sched_setaffinity");
  }
  leader = event(PERF_COUNT_HW_INSTRUCTIONS | ((uint64_t)type << 32), -1);
  if (leader < 0) return failure(env, "perf_event_open instructions");
  cycles = event(PERF_COUNT_HW_CPU_CYCLES | ((uint64_t)type << 32), leader);
  if (cycles < 0) { close(leader); leader = -1; return failure(env, "perf_event_open cycles"); }
  napi_value result;
  napi_get_boolean(env, true, &result);
  return result;
}

static napi_value start(napi_env env, napi_callback_info info) {
  (void)info;
  if (leader < 0) { errno = EBADF; return failure(env, "counter start"); }
  uint64_t values[5];
  if (read(leader, values, sizeof(values)) != sizeof(values)) return failure(env, "counter baseline");
  previous_enabled = values[1];
  previous_running = values[2];
  if (ioctl(leader, PERF_EVENT_IOC_RESET, PERF_IOC_FLAG_GROUP)) return failure(env, "counter reset");
  if (ioctl(leader, PERF_EVENT_IOC_ENABLE, PERF_IOC_FLAG_GROUP)) return failure(env, "counter enable");
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

static napi_value stop(napi_env env, napi_callback_info info) {
  (void)info;
  if (ioctl(leader, PERF_EVENT_IOC_DISABLE, PERF_IOC_FLAG_GROUP)) return failure(env, "counter disable");
  uint64_t values[5];
  if (read(leader, values, sizeof(values)) != sizeof(values) || values[0] != 2) return failure(env, "counter read");
  napi_value result, value;
  napi_create_object(env, &result);
  const char *names[] = {"instructions", "cycles", "enabledNs", "runningNs"};
  const uint64_t numbers[] = {values[3], values[4], values[1] - previous_enabled, values[2] - previous_running};
  for (int i = 0; i < 4; ++i) {
    napi_create_double(env, (double)numbers[i], &value);
    napi_set_named_property(env, result, names[i], value);
  }
  return result;
}

static napi_value busy(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argument;
  uint32_t count = 0;
  napi_get_cb_info(env, info, &argc, &argument, NULL, NULL);
  napi_get_value_uint32(env, argument, &count);
  uint64_t result = 0;
#if defined(__x86_64__)
  uint64_t remaining = count;
  if (remaining) __asm__ volatile("1: add $3, %0\n dec %1\n jnz 1b" : "+r"(result), "+r"(remaining) : : "cc");
#else
  for (uint32_t i = 0; i < count; ++i) result += 3;
#endif
  napi_value value;
  napi_create_double(env, (double)result, &value);
  return value;
}

static napi_value close_counters(napi_env env, napi_callback_info info) {
  (void)info;
  if (cycles >= 0) close(cycles);
  if (leader >= 0) close(leader);
  cycles = leader = -1;
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

NAPI_MODULE_INIT() {
  napi_property_descriptor descriptors[] = {
    {"open", NULL, open_counters, NULL, NULL, NULL, napi_default, NULL},
    {"start", NULL, start, NULL, NULL, NULL, napi_default, NULL},
    {"stop", NULL, stop, NULL, NULL, NULL, napi_default, NULL},
    {"busy", NULL, busy, NULL, NULL, NULL, napi_default, NULL},
    {"close", NULL, close_counters, NULL, NULL, NULL, napi_default, NULL},
  };
  napi_define_properties(env, exports, sizeof(descriptors) / sizeof(descriptors[0]), descriptors);
  return exports;
}
