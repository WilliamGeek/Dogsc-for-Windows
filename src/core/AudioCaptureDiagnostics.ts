// Port of: F:\dogsc\Sources\RecorderCore\AudioCaptureDiagnostics.swift

import { max } from './swift.ts';

/// Persistable evidence for one real-time audio writer. Audio callbacks are
/// packet based, so counts describe sample buffers rather than PCM frames.
export interface AudioCaptureDiagnostics {
  readonly receivedSampleBuffers: number;
  readonly appendedSampleBuffers: number;
  readonly ingressDrops: number;
  readonly writerBackpressureDrops: number;
  readonly invalidTimestampDrops: number;
  readonly nonMonotonicTimestampDrops: number;
  readonly formatChangeDrops: number;
  readonly otherDrops: number;
  readonly elapsed: number;
  readonly maximumSampleInterval: number;
  readonly totalDroppedSampleBuffers: number;
  readonly appendedSampleBuffersPerSecond: number;
}

export function makeAudioCaptureDiagnostics(options: {
  receivedSampleBuffers: number;
  appendedSampleBuffers: number;
  ingressDrops?: number;
  writerBackpressureDrops?: number;
  invalidTimestampDrops?: number;
  nonMonotonicTimestampDrops?: number;
  formatChangeDrops?: number;
  otherDrops?: number;
  elapsed: number;
  maximumSampleInterval?: number;
}): AudioCaptureDiagnostics {
  const receivedSampleBuffers = max(options.receivedSampleBuffers, 0);
  const appendedSampleBuffers = max(options.appendedSampleBuffers, 0);
  const ingressDrops = max(options.ingressDrops ?? 0, 0);
  const writerBackpressureDrops = max(options.writerBackpressureDrops ?? 0, 0);
  const invalidTimestampDrops = max(options.invalidTimestampDrops ?? 0, 0);
  const nonMonotonicTimestampDrops = max(options.nonMonotonicTimestampDrops ?? 0, 0);
  const formatChangeDrops = max(options.formatChangeDrops ?? 0, 0);
  const otherDrops = max(options.otherDrops ?? 0, 0);
  const elapsed = max(Number.isFinite(options.elapsed) ? options.elapsed : 0, 0);
  const maximumSampleInterval = max(
    Number.isFinite(options.maximumSampleInterval) ? options.maximumSampleInterval! : 0,
    0
  );

  return {
    receivedSampleBuffers,
    appendedSampleBuffers,
    ingressDrops,
    writerBackpressureDrops,
    invalidTimestampDrops,
    nonMonotonicTimestampDrops,
    formatChangeDrops,
    otherDrops,
    elapsed,
    maximumSampleInterval,
    get totalDroppedSampleBuffers(): number {
      return (
        this.ingressDrops +
        this.writerBackpressureDrops +
        this.invalidTimestampDrops +
        this.nonMonotonicTimestampDrops +
        this.formatChangeDrops +
        this.otherDrops
      );
    },
    get appendedSampleBuffersPerSecond(): number {
      if (this.elapsed <= 0) return 0;
      return this.appendedSampleBuffers / this.elapsed;
    },
  };
}
