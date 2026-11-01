// Port of: F:\dogsc\Sources\RecorderCore\RecordingPerformanceDiagnostics.swift

import { min, max } from './swift.ts';

export type RecordingThermalState = 'nominal' | 'fair' | 'serious' | 'critical' | 'unknown';

export const RecordingThermalStateAllCases: readonly RecordingThermalState[] = Object.freeze([
  'nominal',
  'fair',
  'serious',
  'critical',
  'unknown',
]);

function thermalStateSeverity(state: RecordingThermalState): number {
  switch (state) {
    case 'nominal':
      return 0;
    case 'fair':
      return 1;
    case 'serious':
      return 2;
    case 'critical':
      return 3;
    case 'unknown':
      return -1;
  }
}

/// One low-frequency system/process sample associated with a recording run.
/// Media-path counters remain in their dedicated screen/camera/audio types.
export interface RecordingPerformanceSample {
  readonly elapsed: number;
  readonly processCPUPercent: number;
  readonly systemCPUPercent: number;
  readonly processResidentBytes: number;
  readonly processMetalAllocatedBytes: number | null;
  readonly availableDiskBytes: number | null;
  readonly thermalState: RecordingThermalState;
}

export function makeRecordingPerformanceSample(options: {
  elapsed: number;
  processCPUPercent: number;
  systemCPUPercent: number;
  processResidentBytes: number;
  processMetalAllocatedBytes?: number | null;
  availableDiskBytes?: number | null;
  thermalState: RecordingThermalState;
}): RecordingPerformanceSample {
  const elapsed = max(Number.isFinite(options.elapsed) ? options.elapsed : 0, 0);
  const processCPUPercent = max(
    Number.isFinite(options.processCPUPercent) ? options.processCPUPercent : 0,
    0
  );
  const systemCPUPercent = min(
    max(Number.isFinite(options.systemCPUPercent) ? options.systemCPUPercent : 0, 0),
    100
  );
  return {
    elapsed,
    processCPUPercent,
    systemCPUPercent,
    processResidentBytes: options.processResidentBytes,
    processMetalAllocatedBytes: options.processMetalAllocatedBytes ?? null,
    availableDiskBytes: options.availableDiskBytes ?? null,
    thermalState: options.thermalState,
  };
}

export interface RecordingPerformanceSummary {
  readonly sampleCount: number;
  readonly peakProcessCPUPercent: number;
  readonly peakSystemCPUPercent: number;
  readonly peakProcessResidentBytes: number;
  readonly peakProcessMetalAllocatedBytes: number | null;
  readonly minimumAvailableDiskBytes: number | null;
  readonly worstThermalState: RecordingThermalState;
  including(sample: RecordingPerformanceSample): RecordingPerformanceSummary;
}

function maximumOptional(lhs: number | null | undefined, rhs: number | null | undefined): number | null {
  if (lhs != null && rhs != null) return max(lhs, rhs);
  if (lhs != null) return lhs;
  if (rhs != null) return rhs;
  return null;
}

function minimumOptional(lhs: number | null | undefined, rhs: number | null | undefined): number | null {
  if (lhs != null && rhs != null) return min(lhs, rhs);
  if (lhs != null) return lhs;
  if (rhs != null) return rhs;
  return null;
}

export function makeRecordingPerformanceSummary(options: {
  sampleCount: number;
  peakProcessCPUPercent: number;
  peakSystemCPUPercent: number;
  peakProcessResidentBytes: number;
  peakProcessMetalAllocatedBytes?: number | null;
  minimumAvailableDiskBytes?: number | null;
  worstThermalState: RecordingThermalState;
}): RecordingPerformanceSummary {
  return {
    sampleCount: options.sampleCount,
    peakProcessCPUPercent: options.peakProcessCPUPercent,
    peakSystemCPUPercent: options.peakSystemCPUPercent,
    peakProcessResidentBytes: options.peakProcessResidentBytes,
    peakProcessMetalAllocatedBytes: options.peakProcessMetalAllocatedBytes ?? null,
    minimumAvailableDiskBytes: options.minimumAvailableDiskBytes ?? null,
    worstThermalState: options.worstThermalState,
    including(sample: RecordingPerformanceSample): RecordingPerformanceSummary {
      const worstThermal =
        thermalStateSeverity(sample.thermalState) > thermalStateSeverity(this.worstThermalState)
          ? sample.thermalState
          : this.worstThermalState;
      return makeRecordingPerformanceSummary({
        sampleCount: this.sampleCount + 1,
        peakProcessCPUPercent: max(this.peakProcessCPUPercent, sample.processCPUPercent),
        peakSystemCPUPercent: max(this.peakSystemCPUPercent, sample.systemCPUPercent),
        peakProcessResidentBytes: max(this.peakProcessResidentBytes, sample.processResidentBytes),
        peakProcessMetalAllocatedBytes: maximumOptional(
          this.peakProcessMetalAllocatedBytes,
          sample.processMetalAllocatedBytes
        ),
        minimumAvailableDiskBytes: minimumOptional(
          this.minimumAvailableDiskBytes,
          sample.availableDiskBytes
        ),
        worstThermalState: worstThermal,
      });
    },
  };
}

export const RecordingPerformanceSummaryEmpty: RecordingPerformanceSummary = Object.freeze(
  makeRecordingPerformanceSummary({
    sampleCount: 0,
    peakProcessCPUPercent: 0,
    peakSystemCPUPercent: 0,
    peakProcessResidentBytes: 0,
    peakProcessMetalAllocatedBytes: null,
    minimumAvailableDiskBytes: null,
    worstThermalState: 'unknown',
  })
);

export function summarizeRecordingPerformance(
  samples: readonly RecordingPerformanceSample[]
): RecordingPerformanceSummary {
  let summary: RecordingPerformanceSummary | null = null;
  for (const sample of samples) {
    if (!summary) {
      summary = makeRecordingPerformanceSummary({
        sampleCount: 1,
        peakProcessCPUPercent: sample.processCPUPercent,
        peakSystemCPUPercent: sample.systemCPUPercent,
        peakProcessResidentBytes: sample.processResidentBytes,
        peakProcessMetalAllocatedBytes: sample.processMetalAllocatedBytes,
        minimumAvailableDiskBytes: sample.availableDiskBytes,
        worstThermalState: sample.thermalState,
      });
    } else {
      summary = summary.including(sample);
    }
  }
  return summary ?? RecordingPerformanceSummaryEmpty;
}
