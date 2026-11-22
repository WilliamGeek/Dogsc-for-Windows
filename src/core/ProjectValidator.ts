// Port of: F:\dogsc\Sources\RecorderCore\ProjectValidator.swift

import type {
  CanvasStyle,
  CameraStyle,
  AudioStyle,
  CursorStyle,
  MotionStyle,
  OpeningSequence,
  OpeningSequenceElement,
} from './ProjectModel.ts';
import { OpeningSequenceElementAllCases, openingSequenceMaximumStagger } from './ProjectModel.ts';
import type { ZoomAnimationClip } from './ZoomAnimation.ts';
import type { ProjectTimeline } from './ProjectTimeline.ts';
import type { RecorderProject } from './ProjectMediaModel.ts';
import { RecordingSourcePrimaryID } from './RecordingSource.ts';

// MARK: - ProjectValidationError

export type ProjectValidationErrorKind =
  | 'invalidCanvas'
  | 'invalidCamera'
  | 'invalidAudio'
  | 'invalidCursor'
  | 'invalidMotion'
  | 'invalidOpening'
  | 'invalidZoom'
  | 'duplicateZoomID'
  | 'overlappingZoom'
  | 'invalidTimeline';

export class ProjectValidationError extends Error {
  readonly kind: ProjectValidationErrorKind;
  readonly reason?: string;
  readonly clipID?: string;
  readonly firstID?: string;
  readonly secondID?: string;

  constructor(
    kind: ProjectValidationErrorKind,
    options?: { reason?: string; clipID?: string; firstID?: string; secondID?: string }
  ) {
    let msg: string;
    switch (kind) {
      case 'invalidCanvas':
        msg = `画布参数无效：${options?.reason ?? ''}`;
        break;
      case 'invalidCamera':
        msg = `摄像头参数无效：${options?.reason ?? ''}`;
        break;
      case 'invalidAudio':
        msg = `音频参数无效：${options?.reason ?? ''}`;
        break;
      case 'invalidCursor':
        msg = `光标参数无效：${options?.reason ?? ''}`;
        break;
      case 'invalidMotion':
        msg = `动画参数无效：${options?.reason ?? ''}`;
        break;
      case 'invalidOpening':
        msg = `开场编排参数无效：${options?.reason ?? ''}`;
        break;
      case 'invalidZoom':
        msg = `缩放片段无效：${options?.reason ?? ''}`;
        break;
      case 'duplicateZoomID':
        msg = '缩放轨道中存在重复片段。';
        break;
      case 'overlappingZoom':
        msg = '缩放片段的生效区间发生重叠。';
        break;
      case 'invalidTimeline':
        msg = `时间线无效：${options?.reason ?? ''}`;
        break;
    }
    super(msg);
    this.name = 'ProjectValidationError';
    this.kind = kind;
    this.reason = options?.reason;
    this.clipID = options?.clipID;
    this.firstID = options?.firstID;
    this.secondID = options?.secondID;
  }
}

function finite(value: number, minVal: number, maxVal: number): boolean {
  return Number.isFinite(value) && value >= minVal && value <= maxVal;
}

// MARK: - ProjectValidator

export const ProjectValidator = Object.freeze({
  validateCanvas(style: CanvasStyle): void {
    const crop = style.crop;
    const isCropValid =
      finite(crop.x, 0, 1) &&
      finite(crop.y, 0, 1) &&
      finite(crop.width, 0.01, 1) &&
      finite(crop.height, 0.01, 1) &&
      crop.x + crop.width <= 1.000001 &&
      crop.y + crop.height <= 1.000001;

    const valid =
      finite(style.padding, 0, 1000) &&
      finite(style.contentScale, 0.05, 8) &&
      finite(style.contentPosition.x, 0, 1) &&
      finite(style.contentPosition.y, 0, 1) &&
      finite(style.cornerRadius, 0, 500) &&
      finite(style.borderWidth, 0, 60) &&
      finite(style.shadowStrength, 0, 1) &&
      finite(style.backgroundBlur, 0, 96) &&
      finite(style.insetOpacity, 0, 1) &&
      finite(style.screenFrameScale, 0.6, 1.6) &&
      finite(style.screenFrameToolbarScale, 0.65, 1.6) &&
      (style.screenFrameOuterCornerRadius != null
        ? finite(style.screenFrameOuterCornerRadius, 0, 160)
        : true) &&
      (style.screenFrameContentCornerRadius != null
        ? finite(style.screenFrameContentCornerRadius, 0, 160)
        : true) &&
      style.screenFrameTitle.length <= 120 &&
      style.screenFrameBrowserAddress.length <= 240 &&
      isCropValid;

    if (!valid) {
      throw new ProjectValidationError('invalidCanvas', {
        reason: '包含越界、非有限或无效裁切值。',
      });
    }
  },

  validateCamera(style: CameraStyle): void {
    const valid =
      finite(style.position.x, 0, 1) &&
      finite(style.position.y, 0, 1) &&
      finite(style.size, 0.01, 1) &&
      finite(style.borderWidth, 0, 18) &&
      finite(style.shadowStrength, 0, 1) &&
      finite(style.roundness, 0, 1) &&
      finite(style.scaleDuringZoom, 0.1, 2) &&
      finite(style.contentPosition.x, 0, 1) &&
      finite(style.contentPosition.y, 0, 1) &&
      finite(style.contentScale, 1, 4);

    if (!valid) {
      throw new ProjectValidationError('invalidCamera', {
        reason: '位置、大小或外观值超出可渲染范围。',
      });
    }
  },

  validateAudio(style: AudioStyle): void {
    const valid =
      finite(style.systemVolume, 0, 1) && finite(style.microphoneVolume, 0, 1);

    if (!valid) {
      throw new ProjectValidationError('invalidAudio', {
        reason: '音量必须位于 0 到 1。',
      });
    }
  },

  validateCursor(style: CursorStyle): void {
    const assetID = typeof style.assetID === 'string' ? style.assetID : '';
    const valid =
      assetID.length > 0 &&
      finite(style.size, 0.25, 6) &&
      finite(style.idleDelay, 0.2, 8) &&
      finite(style.motionTiltStrength, 2, 4);

    if (!valid) {
      throw new ProjectValidationError('invalidCursor', {
        reason: '尺寸、静止延迟或摆动强度超出支持范围。',
      });
    }
  },

  validateMotion(style: MotionStyle): void {
    if (style.defaultZoomScale != null && !finite(style.defaultZoomScale, 1, 6)) {
      throw new ProjectValidationError('invalidMotion', {
        reason: '新动画倍率必须在 1 到 6 倍之间。',
      });
    }
    if (style.defaultScreenMotion != null) {
      const sm = style.defaultScreenMotion;
      const validSm =
        finite(sm.rotationX, -45, 45) &&
        finite(sm.rotationY, -45, 45) &&
        finite(sm.scale, 0.1, 5);
      if (!validSm) {
        throw new ProjectValidationError('invalidMotion', {
          reason: '新屏幕 3D 动画的参数无法稳定求值。',
        });
      }
    }
    const valid =
      finite(style.screenSpringMass, 0.01, 20) &&
      finite(style.screenSpringStiffness, 1, 5000) &&
      finite(style.screenSpringDamping, 0.1, 1000) &&
      finite(style.cursorSpringMass, 0.01, 20) &&
      finite(style.cursorSpringStiffness, 1, 5000) &&
      finite(style.cursorSpringDamping, 0.1, 1000) &&
      finite(style.defaultZoomTransitionDuration, 0, 5);

    if (!valid) {
      throw new ProjectValidationError('invalidMotion', {
        reason: '弹簧或默认过渡参数无法稳定求值。',
      });
    }
  },

  validateZoomClip(clip: ZoomAnimationClip): void {
    if (
      !Number.isFinite(clip.startTime) ||
      !Number.isFinite(clip.endTime) ||
      clip.startTime < 0 ||
      clip.endTime < clip.startTime ||
      !Number.isFinite(clip.scale) ||
      clip.scale < 1 ||
      !Number.isFinite(clip.enterDuration) ||
      clip.enterDuration < 0 ||
      !Number.isFinite(clip.exitDuration) ||
      clip.exitDuration < 0
    ) {
      throw new ProjectValidationError('invalidZoom', {
        clipID: clip.id,
        reason: '时间范围或缩放倍率无效。',
      });
    }
  },

  validateTimeline(timeline: ProjectTimeline): void {
    const seenZoomIDs = new Set<string>();
    for (const clip of timeline.zoomClips) {
      if (seenZoomIDs.has(clip.id)) {
        throw new ProjectValidationError('duplicateZoomID', { clipID: clip.id });
      }
      seenZoomIDs.add(clip.id);
      ProjectValidator.validateZoomClip(clip);
    }

    const sortedZoom = timeline.zoomClips.slice().sort((a, b) => a.startTime - b.startTime);
    for (let i = 0; i < sortedZoom.length - 1; i++) {
      const first = sortedZoom[i];
      const second = sortedZoom[i + 1];
      if (second.startTime < first.endTime - 0.000001) {
        throw new ProjectValidationError('overlappingZoom', {
          firstID: first.id,
          secondID: second.id,
        });
      }
    }
  },

  validateOpening(opening: OpeningSequence): void {
    const allCases = ['屏幕', '摄像头', '贴图'] as const;
    const includedSet = new Set(opening.includedElements);
    const orderSet = new Set(opening.elementOrder);

    const valid =
      finite(opening.duration, 0.4, 8) &&
      finite(opening.stagger, 0, 1.2) &&
      opening.stagger <=
        openingSequenceMaximumStagger(opening.duration, opening.includedElements.length) +
          0.000001 &&
      includedSet.size === opening.includedElements.length &&
      orderSet.size === allCases.length &&
      allCases.every((c) => orderSet.has(c));

    if (!valid) {
      throw new ProjectValidationError('invalidOpening', {
        reason: '时长、间隔或元素顺序无效。',
      });
    }
  },

  validate(target: CanvasStyle | CameraStyle | AudioStyle | CursorStyle | MotionStyle | ZoomAnimationClip | ProjectTimeline | RecorderProject): void {
    if ('title' in target && 'canvas' in target && 'timeline' in target) {
      const project = target as RecorderProject;
      ProjectValidator.validateCanvas(project.canvas);
      ProjectValidator.validateCamera(project.camera);
      ProjectValidator.validateAudio(project.audio);
      ProjectValidator.validateCursor(project.cursorStyle);
      ProjectValidator.validateMotion(project.motion);
      ProjectValidator.validateOpening(project.openingSequence);
      // A segment pointing at a removed recording stays renderable-looking
      // in the model while every preview and export fails on load. Reject it
      // here so no edit or save can introduce a dangling reference.
      if (project.timeline.sourceSequence.kind === 'edited') {
        const available = new Set<string>([
          RecordingSourcePrimaryID,
          ...(project.additionalSources ?? []).map((s) => s.id),
        ]);
        for (const segment of project.timeline.sourceSequence.segments) {
          if (segment.media == null) {
            const resolved = segment.sourceID ?? RecordingSourcePrimaryID;
            if (!available.has(resolved)) {
              throw new ProjectValidationError('invalidTimeline', {
                reason: '主轨片段引用的录制已不在项目中。',
              });
            }
          }
        }
      }
      ProjectValidator.validateTimeline(project.timeline);
      return;
    }
    if ('zoomClips' in target && 'sourceSequence' in target) {
      ProjectValidator.validateTimeline(target as ProjectTimeline);
      return;
    }
    if ('scale' in target && 'focus' in target && 'enterDuration' in target) {
      ProjectValidator.validateZoomClip(target as ZoomAnimationClip);
      return;
    }
    if ('padding' in target && 'contentScale' in target) {
      ProjectValidator.validateCanvas(target as CanvasStyle);
      return;
    }
    if ('position' in target && 'roundness' in target) {
      ProjectValidator.validateCamera(target as CameraStyle);
      return;
    }
    if ('systemVolume' in target && 'microphoneVolume' in target) {
      ProjectValidator.validateAudio(target as AudioStyle);
      return;
    }
    if ('assetID' in target && 'idleDelay' in target) {
      ProjectValidator.validateCursor(target as CursorStyle);
      return;
    }
    if ('screenSpringMass' in target && 'cursorSpringMass' in target) {
      ProjectValidator.validateMotion(target as MotionStyle);
      return;
    }
  },
});
