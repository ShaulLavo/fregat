import CoreGraphics
import Foundation

/// Everything about this machine that a later reader needs in order to know
/// whether a number is comparable to theirs. Bench results without this header
/// are not evidence — tail latencies on this machine drift roughly 2x after an
/// hour of heavy benching, so a bare millisecond figure means nothing.
struct MachineProfile {
  let cpuBrand: String
  let performanceCores: Int
  let efficiencyCores: Int
  let memoryGiB: Double
  let osVersion: String
  let displayRefreshHz: Double
  let displayPixels: (width: Int, height: Int)?
  let buildIsRelease: Bool

  /// Target refresh the editor is designed for, regardless of what is plugged
  /// in here. Building to 60 Hz because the dev machine is 60 Hz bakes in a
  /// budget that ProMotion doubles.
  static let promotionHz = 120.0

  var localFrameBudgetMs: Double { 1_000 / displayRefreshHz }
  var targetFrameBudgetMs: Double { 1_000 / Self.promotionHz }

  static func current() -> MachineProfile {
    MachineProfile(
      cpuBrand: sysctlString("machdep.cpu.brand_string") ?? "unknown",
      performanceCores: sysctlInt("hw.perflevel0.logicalcpu") ?? sysctlInt("hw.ncpu") ?? 0,
      efficiencyCores: sysctlInt("hw.perflevel1.logicalcpu") ?? 0,
      memoryGiB: Double(sysctlInt64("hw.memsize") ?? 0) / 1_073_741_824,
      osVersion: ProcessInfo.processInfo.operatingSystemVersionString,
      displayRefreshHz: mainDisplayRefreshHz(),
      displayPixels: mainDisplayPixels(),
      buildIsRelease: !isDebugBuild
    )
  }

  static var isDebugBuild: Bool {
    #if DEBUG
      return true
    #else
      return false
    #endif
  }

  /// Fixed integer workload, identical in shape to the web harness's in-page
  /// calibration loop (`apps/web/scripts/bench-workspace.ts`). Compare it only
  /// against other EditorBench runs — Swift and V8 do not produce comparable
  /// absolute times — and read every result in this run relative to it.
  static func cpuCalibration() -> Double {
    // Seeded from the pid: with a constant seed LLVM folds the whole loop at
    // compile time and the calibration reads 0.00 ms.
    let seed = Int(ProcessInfo.processInfo.processIdentifier) % 7
    let samples = Bench.measure(iterations: 3) {
      var accumulator = seed
      for index in 0..<20_000_000 {
        accumulator = (accumulator &+ index &* 31) % 1_000_003
      }
      benchSink = accumulator
    }
    return samples.minMs
  }
}

/// Where benchmark results go to keep the optimizer from deleting the work
/// that produced them. A store to global mutable state is opaque enough that
/// LLVM cannot prove the computation dead.
nonisolated(unsafe) var benchSink = 0

private func mainDisplayRefreshHz() -> Double {
  let display = CGMainDisplayID()
  guard let mode = CGDisplayCopyDisplayMode(display) else { return 60 }
  guard mode.refreshRate > 0 else { return 60 }

  return mode.refreshRate
}

private func mainDisplayPixels() -> (width: Int, height: Int)? {
  guard let mode = CGDisplayCopyDisplayMode(CGMainDisplayID()) else { return nil }

  return (mode.pixelWidth, mode.pixelHeight)
}

private func sysctlString(_ name: String) -> String? {
  var size = 0
  guard sysctlbyname(name, nil, &size, nil, 0) == 0, size > 0 else { return nil }

  var buffer = [UInt8](repeating: 0, count: size)
  guard sysctlbyname(name, &buffer, &size, nil, 0) == 0 else { return nil }

  return String(decoding: buffer.prefix(while: { $0 != 0 }), as: UTF8.self)
}

private func sysctlInt(_ name: String) -> Int? {
  sysctlInt64(name).map(Int.init)
}

private func sysctlInt64(_ name: String) -> Int64? {
  var value: Int64 = 0
  var size = MemoryLayout<Int64>.size
  guard sysctlbyname(name, &value, &size, nil, 0) == 0 else { return nil }

  return value
}
