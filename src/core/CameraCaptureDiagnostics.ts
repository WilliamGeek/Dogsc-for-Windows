// Port of: F:\dogsc\Sources\RecorderCore\CameraCaptureDiagnostics.swift

/// Persistable evidence for one camera recording. It lives in RecorderCore so
/// the standalone project-store verifier and the signed App share the exact
/// same recovery-manifest schema.
export interface CameraCaptureDiagnostics {
  readonly receivedFrames: number;
  readonly appendedFrames: number;
  readonly systemLateDrops: number;
  readonly systemOutOfBufferDrops: number;
  readonly systemDiscontinuityDrops: number;
  readonly systemUnknownDrops: number;
  readonly encoderBackpressureDrops: number;
  readonly nonMonotonicTimestampDrops: number;
  readonly invalidSampleDrops: number;
  readonly normalizedFrames: number;
  readonly formatChanges: number;
  readonly initialWidth: number | null;
  readonly initialHeight: number | null;
  readonly finalWidth: number | null;
  readonly finalHeight: number | null;
  readonly initialPixelFormat: number | null;
  readonly finalPixelFormat: number | null;
  readonly initialPlaneCount: number | null;
  readonly finalPlaneCount: number | null;
  readonly initialBytesPerRow: readonly number[] | null;
  readonly finalBytesPerRow: readonly number[] | null;
  readonly elapsed: number;
  readonly maximumFrameInterval: number;
  readonly sessionInterruptionCount: number;
  readonly sessionRuntimeErrorCount: number;

  readonly systemDroppedFrames: number;
  readonly applicationDroppedFrames: number;
  readonly receivedFramesPerSecond: number;
  readonly appendedFramesPerSecond: number;
}

export function makeCameraCaptureDiagnostics(options: {
  receivedFrames: number;
  appendedFrames: number;
  systemLateDrops: number;
  systemOutOfBufferDrops: number;
  systemDiscontinuityDrops: number;
  systemUnknownDrops: number;
  encoderBackpressureDrops: number;
  nonMonotonicTimestampDrops: number;
  invalidSampleDrops?: number;
  normalizedFrames: number;
  formatChanges: number;
  initialWidth?: number | null;
  initialHeight?: number | null;
  finalWidth?: number | null;
  finalHeight?: number | null;
  initialPixelFormat?: number | null;
  finalPixelFormat?: number | null;
  initialPlaneCount?: number | null;
  finalPlaneCount?: number | null;
  initialBytesPerRow?: readonly number[] | null;
  finalBytesPerRow?: readonly number[] | null;
  elapsed: number;
  maximumFrameInterval: number;
  sessionInterruptionCount?: number;
  sessionRuntimeErrorCount?: number;
}): CameraCaptureDiagnostics {
  return {
    receivedFrames: options.receivedFrames,
    appendedFrames: options.appendedFrames,
    systemLateDrops: options.systemLateDrops,
    systemOutOfBufferDrops: options.systemOutOfBufferDrops,
    systemDiscontinuityDrops: options.systemDiscontinuityDrops,
    systemUnknownDrops: options.systemUnknownDrops,
    encoderBackpressureDrops: options.encoderBackpressureDrops,
    nonMonotonicTimestampDrops: options.nonMonotonicTimestampDrops,
    invalidSampleDrops: options.invalidSampleDrops ?? 0,
    normalizedFrames: options.normalizedFrames,
    formatChanges: options.formatChanges,
    initialWidth: options.initialWidth ?? null,
    initialHeight: options.initialHeight ?? null,
    finalWidth: options.finalWidth ?? null,
    finalHeight: options.finalHeight ?? null,
    initialPixelFormat: options.initialPixelFormat ?? null,
    finalPixelFormat: options.finalPixelFormat ?? null,
    initialPlaneCount: options.initialPlaneCount ?? null,
    finalPlaneCount: options.finalPlaneCount ?? null,
    initialBytesPerRow: options.initialBytesPerRow ? [...options.initialBytesPerRow] : null,
    finalBytesPerRow: options.finalBytesPerRow ? [...options.finalBytesPerRow] : null,
    elapsed: options.elapsed,
    maximumFrameInterval: options.maximumFrameInterval,
    sessionInterruptionCount: options.sessionInterruptionCount ?? 0,
    sessionRuntimeErrorCount: options.sessionRuntimeErrorCount ?? 0,

    get systemDroppedFrames(): number {
      return (
        this.systemLateDrops +
        this.systemOutOfBufferDrops +
        this.systemDiscontinuityDrops +
        this.systemUnknownDrops
      );
    },
    get applicationDroppedFrames(): number {
      return (
        this.encoderBackpressureDrops +
        this.nonMonotonicTimestampDrops +
        this.invalidSampleDrops
      );
    },
    get receivedFramesPerSecond(): number {
      if (this.elapsed <= 0 || this.receivedFrames <= 1) return 0;
      return (this.receivedFrames - 1) / this.elapsed;
    },
    get appendedFramesPerSecond(): number {
      if (this.elapsed <= 0 || this.appendedFrames <= 1) return 0;
      return (this.appendedFrames - 1) / this.elapsed;
    },
  };
}
