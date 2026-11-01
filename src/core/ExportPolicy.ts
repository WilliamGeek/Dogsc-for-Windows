// Port of: F:\dogsc\Sources\RecorderCore\ExportPolicy.swift

import { min, max } from './swift.ts';
import type { RecorderProject } from './ProjectMediaModel.ts';
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

  constructor(project: RecorderProject) {
    this.screenVideo = true;

    let recordingSegmentIDs: string[];
    switch (project.timeline.sourceSequence.kind) {
      case 'fullRecording':
        recordingSegmentIDs = [TimelineMap.fullRecordingSegmentID];
        break;
      case 'edited':
        recordingSegmentIDs = project.timeline.sourceSequence.segments.map((s) => s.id);
        break;
    }

    this.systemAudio = recordingSegmentIDs.some((id) => {
      const overrides = project.timeline.primarySegmentAudioOverrides[id];
      const isMuted = overrides?.isSystemMuted ?? project.audio.isSystemMuted;
      const volume = overrides?.systemVolume ?? project.audio.systemVolume;
      return !isMuted && volume > 0;
    });

    this.cameraVideo =
      project.media?.camera != null && !project.camera.isHidden;

    this.microphoneAudio =
      project.media?.microphone != null &&
      recordingSegmentIDs.some((id) => {
        const overrides = project.timeline.primarySegmentAudioOverrides[id];
        const isMuted = overrides?.isMicrophoneMuted ?? project.audio.isMicrophoneMuted;
        const volume = overrides?.microphoneVolume ?? project.audio.microphoneVolume;
        return !isMuted && volume > 0;
      });

    const bg = project.canvas.backgroundSource;
    this.backgroundImage = bg.kind === 'image';
    this.backgroundVideo = bg.kind === 'video';
  }
}

// MARK: - ExportEncodingPolicy

/**
 * Shared by the export UI and the encoder so the estimate cannot advertise a
 * different policy from the job that will actually run.
 */
export const ExportEncodingPolicy = Object.freeze({
  audioBitrate: 192000,

  videoBitrate(width: number, height: number, frameRate: number): number {
    const pixels = max(width * height, 1);
    let ceiling: number;
    if (pixels >= 7000000) {
      // ≈ 4K (3840×2160 = 8.29M)
      ceiling = 130000000;
    } else if (pixels >= 3500000) {
      // ≈ 1440p (2560×1440 = 3.69M)
      ceiling = 100000000;
    } else {
      ceiling = 65000000;
    }
    return min(max(Math.floor((pixels * max(frameRate, 1)) / 6), 12000000), ceiling);
  },
});
