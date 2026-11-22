// Port of: F:\dogsc-v0.2.0\Sources\RecorderCore\ExportPolicy.swift

import { min, max } from './swift.ts';
import type { ExportQuality, ExportVideoCodec } from './ExportSettings.ts';
import type { RecorderProject } from './ProjectMediaModel.ts';
import {
  backgroundSourceIsImage,
  backgroundSourceIsVideo,
} from './ProjectModel.ts';
import { recordingSegmentResolvedSourceID } from './ProjectTimeline.ts';
import {
  RecordingSourcePrimaryID,
  projectSourceByID,
} from './RecordingSource.ts';
import { projectTimelineRecordingSegmentByID } from './SegmentSceneStyle.ts';
import { TimelineMap } from './TimelineMap.ts';

// MARK: - RequiredProjectMedia

/**
 * The post-production state, rather than capture-time switches, decides
 * which optional files are required to render a project.
 */
export class RequiredProjectMedia {
  readonly screenVideo: boolean;
  readonly systemAudio: boolean;
  readonly cameraVideo: boolean;
  readonly microphoneAudio: boolean;
  readonly backgroundImage: boolean;
  readonly backgroundVideo: boolean;

  constructor(project: RecorderProject, sourceID: string | null = null) {
    this.screenVideo = true;

    let recordingSegments: Array<{ id: string; sourceID: string }>;
    switch (project.timeline.sourceSequence.kind) {
      case 'fullRecording':
        recordingSegments = [
          {
            id: TimelineMap.fullRecordingSegmentID,
            sourceID: RecordingSourcePrimaryID,
          },
        ];
        break;
      case 'edited':
        recordingSegments = project.timeline.sourceSequence.segments
          .filter((s) => s.media == null)
          .map((s) => ({
            id: s.id,
            sourceID: recordingSegmentResolvedSourceID(s),
          }));
        break;
    }

    const selected =
      sourceID === null
        ? recordingSegments
        : recordingSegments.filter((seg) => seg.sourceID === sourceID);

    this.systemAudio = selected.some((seg) => {
      const overrides = project.timeline.primarySegmentAudioOverrides[seg.id];
      const isMuted = overrides?.isSystemMuted ?? project.audio.isSystemMuted;
      const volume = overrides?.systemVolume ?? project.audio.systemVolume;
      return !isMuted && volume > 0;
    });

    this.cameraVideo = selected.some((seg) => {
      const segCameraHidden =
        projectTimelineRecordingSegmentByID(project.timeline, seg.id)?.sceneStyle
          ?.camera.isHidden ?? project.camera.isHidden;
      if (segCameraHidden) return false;
      return projectSourceByID(project, seg.sourceID)?.media.camera != null;
    });

    this.microphoneAudio = selected.some((seg) => {
      if (projectSourceByID(project, seg.sourceID)?.media.microphone == null) {
        return false;
      }
      const overrides = project.timeline.primarySegmentAudioOverrides[seg.id];
      const isMuted =
        overrides?.isMicrophoneMuted ?? project.audio.isMicrophoneMuted;
      const volume =
        overrides?.microphoneVolume ?? project.audio.microphoneVolume;
      return !isMuted && volume > 0;
    });

    const bg = project.canvas.backgroundSource;
    this.backgroundImage = backgroundSourceIsImage(bg);
    this.backgroundVideo = backgroundSourceIsVideo(bg);
  }
}

// MARK: - ExportEncodingPolicy

/**
 * Shared by the export UI and the encoder so the estimate cannot advertise a
 * different policy from the job that will actually run.
 */
export const ExportEncodingPolicy = Object.freeze({
  audioBitrate: 192_000,

  videoBitrate(
    width: number,
    height: number,
    frameRate: number,
    codec: ExportVideoCodec = 'h264',
    quality: ExportQuality = 'high',
  ): number {
    // H.264 SDR delivery targets at 30/60 fps. Interpolate by actual
    // encoded pixel count so portrait, square and native sizes follow
    // the same budget rather than depending on a resolution label.
    const anchors = [
      { pixels: 1_280 * 720, fps30: 5_000_000, fps60: 7_500_000 },
      { pixels: 1_920 * 1_080, fps30: 8_000_000, fps60: 12_000_000 },
      { pixels: 2_560 * 1_440, fps30: 16_000_000, fps60: 24_000_000 },
      { pixels: 3_840 * 2_160, fps30: 40_000_000, fps60: 55_000_000 },
    ] as const;

    const pixels = max(width, 1) * max(height, 1);
    const fps = max(frameRate, 1);
    const rate = (anchor: (typeof anchors)[number]): number => {
      if (fps <= 30) return (anchor.fps30 * fps) / 30;
      if (fps >= 60) return (anchor.fps60 * fps) / 60;
      return anchor.fps30 + ((anchor.fps60 - anchor.fps30) * (fps - 30)) / 30;
    };

    let referenceRate = (rate(anchors[0]) * pixels) / anchors[0].pixels;
    const upperIndex = anchors.findIndex((a) => a.pixels >= pixels);
    if (upperIndex > 0) {
      const lower = anchors[upperIndex - 1];
      const upper = anchors[upperIndex];
      const fraction = (pixels - lower.pixels) / (upper.pixels - lower.pixels);
      referenceRate = rate(lower) + (rate(upper) - rate(lower)) * fraction;
    } else if (pixels > anchors[anchors.length - 1].pixels) {
      const last = anchors[anchors.length - 1];
      referenceRate = (rate(last) * pixels) / last.pixels;
    }

    let qualityScale = 1.0;
    switch (quality) {
      case 'compact':
        qualityScale = 0.6;
        break;
      case 'high':
        qualityScale = 1.0;
        break;
      case 'maximum':
        qualityScale = 1.5;
        break;
    }
    const codecScale = codec === 'hevc' ? 0.75 : 1.0;
    return Math.round(max(referenceRate * qualityScale * codecScale, 250_000));
  },
});

// MARK: - CaptureEncodingPolicy

/// Capture keeps its editing-quality budget independently of delivery presets.
export const CaptureEncodingPolicy = Object.freeze({
  videoBitrate(width: number, height: number, frameRate: number): number {
    const pixels = max(width * height, 1);
    // High-resolution ceilings: the flat 65 Mbps cap (fine for 1080p)
    // visibly bands and blocks screen content at 1440p+ / 4K, where the
    // pixel-count formula alone already asks for 80–165 Mbps.
    let ceiling: number;
    if (pixels >= 7_000_000) {
      ceiling = 130_000_000;
    } else if (pixels >= 3_500_000) {
      ceiling = 100_000_000;
    } else {
      ceiling = 65_000_000;
    }
    return min(max(Math.trunc((pixels * max(frameRate, 1)) / 6), 12_000_000), ceiling);
  },
});
