// Port of: F:\dogsc\Sources\RecorderCore\CaptureConfiguration.swift

import { min, max } from './swift.ts';

// MARK: - OutputFrameRate

export type OutputFrameRate = 30 | 60 | 90 | 120;

export const OutputFrameRate = Object.freeze({
  fps30: 30 as OutputFrameRate,
  fps60: 60 as OutputFrameRate,
  fps90: 90 as OutputFrameRate,
  fps120: 120 as OutputFrameRate,

  exportProductChoices: [30, 60] as readonly OutputFrameRate[],
  captureEncodingQualityTarget: 60 as OutputFrameRate,

  frameDuration(rate: OutputFrameRate): number {
    return 1.0 / rate;
  },

  label(rate: OutputFrameRate): string {
    return `${rate} FPS`;
  },
});

// MARK: - CameraCaptureResolution

export class CameraCaptureResolution {
  readonly width: number;
  readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  get id(): string {
    return `${this.width}x${this.height}`;
  }

  get resolutionLabel(): string {
    if (
      (this.width === 3840 && this.height === 2160) ||
      (this.width === 4096 && this.height === 2160)
    ) {
      return '4K';
    }
    if (this.width === 2560 && this.height === 1440) return '1440p';
    if (this.width === 1920 && this.height === 1080) return '1080p';
    if (this.width === 1280 && this.height === 720) return '720p';
    return `${this.width}×${this.height}`;
  }

  get aspectRatioLabel(): string {
    const divisor = CameraCaptureResolution.greatestCommonDivisor(this.width, this.height);
    return `${Math.floor(this.width / divisor)}:${Math.floor(this.height / divisor)}`;
  }

  get label(): string {
    return `${this.resolutionLabel} · ${this.aspectRatioLabel} · ${this.width}×${this.height}`;
  }

  private static greatestCommonDivisor(lhs: number, rhs: number): number {
    let a = max(Math.abs(Math.floor(lhs)), 1);
    let b = max(Math.abs(Math.floor(rhs)), 1);
    while (b !== 0) {
      const temp = b;
      b = a % b;
      a = temp;
    }
    return max(a, 1);
  }
}

// MARK: - CaptureSource & SystemAudioScope

export type CaptureSource = '整块屏幕' | '单个窗口' | '自选区域' | 'iOS 设备';
export const CaptureSource = Object.freeze({
  display: '整块屏幕' as CaptureSource,
  window: '单个窗口' as CaptureSource,
  area: '自选区域' as CaptureSource,
  device: 'iOS 设备' as CaptureSource,
});

export type SystemAudioScope = '全部系统声音' | '所选窗口 App';
export const SystemAudioScope = Object.freeze({
  all: '全部系统声音' as SystemAudioScope,
  selectedApplication: '所选窗口 App' as SystemAudioScope,
});

// MARK: - NormalizedRect

export interface NormalizedRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function makeNormalizedRect(options: {
  x: number;
  y: number;
  width: number;
  height: number;
}): NormalizedRect {
  return {
    x: options.x,
    y: options.y,
    width: options.width,
    height: options.height,
  };
}

export function normalizedRectConstrained(rect: NormalizedRect): NormalizedRect {
  const safeX = min(max(rect.x, 0), 1);
  const safeY = min(max(rect.y, 0), 1);
  return {
    x: safeX,
    y: safeY,
    width: min(max(rect.width, 0.02), 1 - safeX),
    height: min(max(rect.height, 0.02), 1 - safeY),
  };
}

export const NormalizedRect = Object.freeze({
  make: makeNormalizedRect,
  constrained: normalizedRectConstrained,
});

// MARK: - CaptureDimensions

export interface CaptureDimensions {
  readonly width: number;
  readonly height: number;
}

export function makeCaptureDimensions(width: number, height: number): CaptureDimensions {
  return { width, height };
}

export function captureDimensionsH264Compatible(
  sourceWidth: number,
  sourceHeight: number,
  maximumWidth: number = 4096,
  maximumHeight: number = 2304
): CaptureDimensions {
  const safeWidth = max(sourceWidth, 2);
  const safeHeight = max(sourceHeight, 2);
  const scale = min(1, maximumWidth / safeWidth, maximumHeight / safeHeight);
  const width = max(Math.floor(Math.floor(safeWidth * scale) / 2) * 2, 2);
  const height = max(Math.floor(Math.floor(safeHeight * scale) / 2) * 2, 2);
  return { width, height };
}

export const CaptureDimensions = Object.freeze({
  make: makeCaptureDimensions,
  h264Compatible: captureDimensionsH264Compatible,
});

// MARK: - CaptureCodec

export type CaptureCodec = 'HEVC' | 'H.264' | 'ProRes 422';
export const CaptureCodec = Object.freeze({
  hevc: 'HEVC' as CaptureCodec,
  h264: 'H.264' as CaptureCodec,
  proRes422: 'ProRes 422' as CaptureCodec,

  usesMOVContainer(codec: CaptureCodec): boolean {
    return codec === 'ProRes 422';
  },

  recordingLabel(codec: CaptureCodec): string {
    switch (codec) {
      case 'HEVC':
        return 'HEVC（H.265，原生分辨率）';
      case 'H.264':
        return 'H.264（兼容模式，最高 4K）';
      case 'ProRes 422':
        return 'ProRes 422（原生分辨率）';
    }
  },
});

// MARK: - CaptureResolutionLimit

export type CaptureResolutionLimit = '原始分辨率' | '最高 4K' | '最高 1080p';
export const CaptureResolutionLimit = Object.freeze({
  native: '原始分辨率' as CaptureResolutionLimit,
  uhd: '最高 4K' as CaptureResolutionLimit,
  fullHD: '最高 1080p' as CaptureResolutionLimit,

  applying(limit: CaptureResolutionLimit, size: CaptureDimensions): CaptureDimensions {
    if (limit === '原始分辨率') return size;
    const longEdge = limit === '最高 4K' ? 3840 : 1920;
    const shortEdge = limit === '最高 4K' ? 2160 : 1080;
    return captureDimensionsH264Compatible(
      size.width,
      size.height,
      size.width >= size.height ? longEdge : shortEdge,
      size.width >= size.height ? shortEdge : longEdge
    );
  },
});

// MARK: - CaptureConfiguration

export interface CaptureConfiguration {
  source: CaptureSource;
  displayID: number | null;
  displayName: string | null;
  windowID: number | null;
  windowName: string | null;
  selectedApplicationBundleIdentifier: string | null;
  selectedApplicationName: string | null;
  area: NormalizedRect | null;
  deviceID: string | null;
  deviceName: string | null;
  captureFrameRate: OutputFrameRate;
  captureCodec: CaptureCodec;
  captureResolutionLimit: CaptureResolutionLimit;
  hidesDesktopFiles: boolean;
  hidesDock: boolean;
  recordsSystemAudio: boolean;
  systemAudioScope: SystemAudioScope;
  recordsMicrophone: boolean;
  microphoneDeviceID: string | null;
  microphoneDeviceName: string | null;
  recordsCamera: boolean;
  cameraDeviceID: string | null;
  cameraDeviceName: string | null;
  cameraCaptureResolution: CameraCaptureResolution | null;
}

export function makeCaptureConfiguration(
  options?: Partial<CaptureConfiguration>
): CaptureConfiguration {
  return {
    source: options?.source ?? CaptureSource.display,
    displayID: options?.displayID ?? null,
    displayName: options?.displayName ?? null,
    windowID: options?.windowID ?? null,
    windowName: options?.windowName ?? null,
    selectedApplicationBundleIdentifier:
      options?.selectedApplicationBundleIdentifier ?? null,
    selectedApplicationName: options?.selectedApplicationName ?? null,
    area: options?.area ? makeNormalizedRect(options.area) : null,
    deviceID: options?.deviceID ?? null,
    deviceName: options?.deviceName ?? null,
    captureFrameRate: options?.captureFrameRate ?? OutputFrameRate.fps60,
    captureCodec: options?.captureCodec ?? CaptureCodec.hevc,
    captureResolutionLimit:
      options?.captureResolutionLimit ?? CaptureResolutionLimit.native,
    hidesDesktopFiles: options?.hidesDesktopFiles ?? false,
    hidesDock: options?.hidesDock ?? false,
    recordsSystemAudio: options?.recordsSystemAudio ?? true,
    systemAudioScope: options?.systemAudioScope ?? SystemAudioScope.all,
    recordsMicrophone: options?.recordsMicrophone ?? false,
    microphoneDeviceID: options?.microphoneDeviceID ?? null,
    microphoneDeviceName: options?.microphoneDeviceName ?? null,
    recordsCamera: options?.recordsCamera ?? false,
    cameraDeviceID: options?.cameraDeviceID ?? null,
    cameraDeviceName: options?.cameraDeviceName ?? null,
    cameraCaptureResolution: options?.cameraCaptureResolution ?? null,
  };
}

// MARK: - FrameIntervalDiagnostics

export class FrameIntervalDiagnostics {
  readonly sampleCount: number;
  readonly p50: number;
  readonly p90: number;
  readonly p95: number;
  readonly p99: number;
  readonly maximum: number;
  readonly over25Milliseconds: number;
  readonly over33Milliseconds: number;
  readonly over50Milliseconds: number;
  readonly maximumConsecutiveOver33Milliseconds: number;

  static readonly empty = new FrameIntervalDiagnostics([]);

  constructor(intervals: readonly number[]) {
    const valid = intervals.filter((n) => Number.isFinite(n) && n > 0);
    this.sampleCount = valid.length;
    this.over25Milliseconds = valid.filter((n) => n > 0.025).length;
    this.over33Milliseconds = valid.filter((n) => n > 1.0 / 30.0).length;
    this.over50Milliseconds = valid.filter((n) => n > 0.05).length;

    let currentRun = 0;
    let longestRun = 0;
    for (const interval of valid) {
      if (interval > 1.0 / 30.0) {
        currentRun += 1;
        longestRun = max(longestRun, currentRun);
      } else {
        currentRun = 0;
      }
    }
    this.maximumConsecutiveOver33Milliseconds = longestRun;

    const sorted = valid.slice().sort((a, b) => a - b);
    this.p50 = FrameIntervalDiagnostics.percentile(0.5, sorted);
    this.p90 = FrameIntervalDiagnostics.percentile(0.9, sorted);
    this.p95 = FrameIntervalDiagnostics.percentile(0.95, sorted);
    this.p99 = FrameIntervalDiagnostics.percentile(0.99, sorted);
    this.maximum = sorted.length > 0 ? sorted[sorted.length - 1] : 0;
  }

  private static percentile(p: number, sorted: readonly number[]): number {
    if (sorted.length === 0) return 0;
    const position = (sorted.length - 1) * min(max(p, 0), 1);
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return sorted[lower];
    const fraction = position - lower;
    return sorted[lower] * (1 - fraction) + sorted[upper] * fraction;
  }
}

// MARK: - FrameRateMeasurement

export class FrameRateMeasurement {
  readonly target: OutputFrameRate;
  readonly receivedFrames: number;
  readonly deliveredFrames: number;
  readonly writerDroppedFrames: number;
  readonly idleFrames: number;
  readonly elapsed: number;
  readonly maxFrameInterval: number;
  readonly intervalDiagnostics: FrameIntervalDiagnostics;

  constructor(options: {
    target: OutputFrameRate;
    receivedFrames?: number | null;
    deliveredFrames: number;
    writerDroppedFrames?: number;
    idleFrames?: number;
    elapsed: number;
    maxFrameInterval?: number;
    intervalDiagnostics?: FrameIntervalDiagnostics;
  }) {
    this.target = options.target;
    this.receivedFrames = options.receivedFrames ?? options.deliveredFrames;
    this.deliveredFrames = options.deliveredFrames;
    this.writerDroppedFrames = options.writerDroppedFrames ?? 0;
    this.idleFrames = options.idleFrames ?? 0;
    this.elapsed = options.elapsed;
    const diag = options.intervalDiagnostics ?? FrameIntervalDiagnostics.empty;
    this.intervalDiagnostics = diag;
    this.maxFrameInterval = max(options.maxFrameInterval ?? 0, diag.maximum);
  }

  get sckDeliveryFramesPerSecond(): number {
    if (this.elapsed <= 0 || this.receivedFrames + this.idleFrames <= 1) return 0;
    return (this.receivedFrames + this.idleFrames) / this.elapsed;
  }

  get isMostlyIdle(): boolean {
    return this.idleFrames > this.receivedFrames;
  }

  get actualFramesPerSecond(): number {
    if (this.elapsed <= 0 || this.deliveredFrames <= 1) return 0;
    return (this.deliveredFrames - 1) / this.elapsed;
  }

  get deliveryRatio(): number {
    if (this.target <= 0) return 0;
    return this.actualFramesPerSecond / this.target;
  }

  get averageFrameInterval(): number {
    if (this.receivedFrames <= 1 || this.elapsed <= 0) return 0;
    return this.elapsed / (this.receivedFrames - 1);
  }

  get estimatedDroppedFrames(): number {
    const expected = Math.round(this.elapsed * this.target) + 1;
    const timelineMissing = max(expected - this.deliveredFrames, 0);
    return max(timelineMissing, this.writerDroppedFrames);
  }

  get droppedFrameRatio(): number {
    const expected = this.deliveredFrames + this.estimatedDroppedFrames;
    if (expected <= 0) return 0;
    return this.estimatedDroppedFrames / expected;
  }
}
