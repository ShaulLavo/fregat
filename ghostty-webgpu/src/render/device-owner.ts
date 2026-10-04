interface DeviceEntry {
  readonly device: Promise<GPUDevice>
  reservations: number
}

export interface DeviceLease {
  readonly device: GPUDevice
  release(): Promise<void>
  retire(): void
}

export class DeviceOwner {
  private current?: DeviceEntry

  constructor(private readonly factory: () => Promise<GPUDevice>) {}

  async acquire(): Promise<DeviceLease> {
    const entry = this.current ?? this.requestEntry()
    entry.reservations += 1
    let device: GPUDevice
    try {
      device = await entry.device
    } catch (cause) {
      entry.reservations -= 1
      throw cause
    }
    let released = false
    return {
      device,
      retire: () => {
        if (this.current === entry) this.current = undefined
      },
      release: async () => {
        if (released) return
        released = true
        entry.reservations -= 1
        if (entry.reservations !== 0) return
        if (this.current === entry) this.current = undefined
        try {
          await device.queue.onSubmittedWorkDone()
        } catch {}
        device.destroy()
      },
    }
  }

  private retireEntry(entry: DeviceEntry): void {
    if (this.current === entry) this.current = undefined
  }

  private requestEntry(): DeviceEntry {
    const entry = { device: this.factory(), reservations: 0 }
    this.current = entry
    void entry.device.then(
      (device) => {
        void device.lost.then(
          () => {
            if (this.current === entry) this.current = undefined
          },
          () => {},
        )
      },
      () => {
        if (this.current === entry) this.current = undefined
      },
    )
    return entry
  }
}
