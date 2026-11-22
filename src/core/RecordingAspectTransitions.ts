// Port of: F:\dogsc-v0.2.0\Sources\RecorderCore\RecordingAspectTransitions.swift
import { clamp } from './swift.ts';
import {
  type NormalizedCrop,
  NormalizedCropFull,
  type ScreenFrameStyle,
  normalizedCropClamped,
  screenFrameStyleIsBrowserFrame,
  screenFrameStyleIsDeviceFrame,
  screenFrameStyleIsWindowFrame,
} from './ProjectModel.ts';
import {
  SEGMENT_APPEARANCE_TRANSITION_DURATION,
  type SegmentSceneStyle,
} from './SegmentSceneStyle.ts';

export const RECORDING_ASPECT_TRANSITION_DURATION = SEGMENT_APPEARANCE_TRANSITION_DURATION;

export interface RecordingAspectSlice {
  outputStart: number;
  outputEnd: number;
  sourceID: string;
  segmentID: string;
  media?: unknown | null;
}

interface AspectTransition {
  start: number;
  from: number;
  to: number;
}

interface AspectSpan {
  start: number;
  end: number;
  sourceID: string;
  cropAspect: number;
  transition: AspectTransition;
}

function transitionValueAt(transition: AspectTransition, time: number): number {
  const x = clamp((time - transition.start) / RECORDING_ASPECT_TRANSITION_DURATION, 0, 1);
  const eased = x * x * (3 - 2 * x);
  return transition.from + (transition.to - transition.from) * eased;
}

export function canTransitionScreenFrame(
  previous: ScreenFrameStyle,
  next: ScreenFrameStyle,
): boolean {
  if (previous === 'none' || next === 'none') return false;
  return (
    (screenFrameStyleIsDeviceFrame(previous) && screenFrameStyleIsDeviceFrame(next)) ||
    (screenFrameStyleIsWindowFrame(previous) && screenFrameStyleIsWindowFrame(next)) ||
    (screenFrameStyleIsBrowserFrame(previous) && screenFrameStyleIsBrowserFrame(next))
  );
}

/// The canvas stays fixed while a recording card settles to the next source's
/// own aspect in 240 ms, only between compatible mockups. The source pixels
/// still use contain fitting. This
/// value is shared by live preview and export, with no wall-clock animation.
export interface RecordingAspectTransitions {
  readonly spans: readonly AspectSpan[];
}

export interface RecordingAspectTransitionInputs {
  slices: readonly RecordingAspectSlice[];
  sourceAspectRatios: ReadonlyMap<string, number>;
  crops: ReadonlyMap<string, NormalizedCrop>;
  frameStyles?: ReadonlyMap<string, ScreenFrameStyle>;
  segmentStyles?: ReadonlyMap<string, SegmentSceneStyle>;
  segmentCrops?: ReadonlyMap<string, NormalizedCrop>;
}

/// `crops` is keyed by recording, `segmentCrops` by occurrence: a clip that
/// opted out of following its recording is framed by the latter, so the
/// aspect this table morphs to has to come from the same authority the
/// renderer samples with. Pass `project.segmentCrops`.
export function makeRecordingAspectTransitions(
  inputs: RecordingAspectTransitionInputs,
): RecordingAspectTransitions {
  const frameStyles = inputs.frameStyles ?? new Map<string, ScreenFrameStyle>();
  const segmentStyles = inputs.segmentStyles ?? new Map<string, SegmentSceneStyle>();
  const segmentCrops = inputs.segmentCrops ?? new Map<string, NormalizedCrop>();

  const spans: AspectSpan[] = [];
  let previousSourceID: string | null = null;
  let previousFrame: ScreenFrameStyle = 'none';
  let previousAspect: number | null = null;
  let transition: AspectTransition | null = null;

  for (const slice of inputs.slices) {
    const aspect = slice.media == null ? inputs.sourceAspectRatios.get(slice.sourceID) : undefined;
    if (aspect === undefined || !Number.isFinite(aspect) || !(aspect > 0)) {
      previousSourceID = null;
      transition = null;
      continue;
    }
    const scene = segmentStyles.get(slice.segmentID);
    const frame = scene?.canvas.screenFrame ?? frameStyles.get(slice.sourceID) ?? 'none';
    const crop = normalizedCropClamped(
      segmentCrops.get(slice.segmentID) ?? inputs.crops.get(slice.sourceID) ?? NormalizedCropFull,
    );
    const croppedAspect = (aspect * crop.width) / crop.height;
    if (previousSourceID === null) {
      transition = { start: slice.outputStart, from: croppedAspect, to: croppedAspect };
    } else if (
      previousSourceID !== slice.sourceID ||
      previousFrame !== frame ||
      previousAspect !== croppedAspect
    ) {
      // A short intervening clip can end before its morph finishes.
      // Start the next morph at that presented value, not its target.
      const compatible = canTransitionScreenFrame(previousFrame, frame);
      transition = {
        start: slice.outputStart,
        from: compatible
          ? (transition ? transitionValueAt(transition, slice.outputStart) : croppedAspect)
          : croppedAspect,
        to: croppedAspect,
      };
    }
    if (transition !== null) {
      spans.push({
        start: slice.outputStart,
        end: slice.outputEnd,
        sourceID: slice.sourceID,
        cropAspect: crop.width / crop.height,
        transition,
      });
    }
    previousSourceID = slice.sourceID;
    previousFrame = frame;
    previousAspect = croppedAspect;
  }

  return { spans };
}

/// Returns the uncropped aspect consumed by the scene evaluator. The
/// evaluator applies this source's crop once, just as it does at rest.
export function recordingAspectRatioAtOutputTime(
  table: RecordingAspectTransitions,
  time: number,
  sourceID: string | null,
): number | null {
  if (!Number.isFinite(time) || sourceID === null) return null;
  const spans = table.spans;
  let lower = 0;
  let upper = spans.length;
  while (lower < upper) {
    const middle = Math.trunc((lower + upper) / 2);
    if (spans[middle].start <= time) {
      lower = middle + 1;
    } else {
      upper = middle;
    }
  }
  if (lower <= 0) return null;
  const span = spans[lower - 1];
  if (span.sourceID !== sourceID || !(time < span.end)) return null;
  return transitionValueAt(span.transition, time) / span.cropAspect;
}

export const RecordingAspectTransitions = Object.freeze({
  duration: RECORDING_ASPECT_TRANSITION_DURATION,
  make: makeRecordingAspectTransitions,
  sourceAspectRatio: recordingAspectRatioAtOutputTime,
});
