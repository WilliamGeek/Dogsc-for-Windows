// Test for: F:\dogsc-win\web\studio\cropOverlay.ts & motionPanel.ts templates

import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCropDragDelta } from '../../web/studio/cropOverlay.ts';
import { buildDmhtmlDocument, HTML_MOTION_TEMPLATES, parseDmhtmlMeta } from '../../web/passes/htmlMotion.ts';
import { makeAnimationClip, makeOverlayTiming } from '../../src/core/OverlayTimeline.ts';
import { makeRecorderProject } from '../../src/core/ProjectMediaModel.ts';
import { makeProjectTimeline } from '../../src/core/ProjectTimeline.ts';
import { ProjectValidator } from '../../src/core/ProjectValidator.ts';
import { makeNormalizedPoint } from '../../src/core/ZoomAnimation.ts';

test('T18.5: applyCropDragDelta handles all 9 handles with [0,1] clamping and minSize protection', () => {
  const full = { x: 0, y: 0, width: 1, height: 1 };

  const tl = applyCropDragDelta(full, 'tl', 0.2, 0.15);
  assert.ok(Math.abs(tl.x - 0.2) < 1e-4);
  assert.ok(Math.abs(tl.y - 0.15) < 1e-4);
  assert.ok(Math.abs(tl.width - 0.8) < 1e-4);
  assert.ok(Math.abs(tl.height - 0.85) < 1e-4);

  const br = applyCropDragDelta(tl, 'br', -0.2, -0.25);
  assert.ok(Math.abs(br.width - 0.6) < 1e-4);
  assert.ok(Math.abs(br.height - 0.6) < 1e-4);

  // Move stays clamped inside [0, 1]
  const moved = applyCropDragDelta({ x: 0.2, y: 0.2, width: 0.5, height: 0.5 }, 'move', 0.8, -0.5);
  assert.ok(Math.abs(moved.x - 0.5) < 1e-4);
  assert.equal(moved.y, 0);
  assert.equal(moved.width, 0.5);
  assert.equal(moved.height, 0.5);

  // Over-shrinking enforces minSize (0.15)
  const shrunk = applyCropDragDelta({ x: 0.1, y: 0.1, width: 0.4, height: 0.4 }, 'r', -0.9, 0, 0.15);
  assert.ok(shrunk.width >= 0.15 - 1e-4);

  // Edge handles
  const edgeT = applyCropDragDelta(full, 't', 0, 0.3);
  assert.ok(Math.abs(edgeT.y - 0.3) < 1e-4 && Math.abs(edgeT.height - 0.7) < 1e-4);
  const edgeB = applyCropDragDelta(full, 'b', 0, -0.25);
  assert.ok(Math.abs(edgeB.height - 0.75) < 1e-4);
  const edgeL = applyCropDragDelta(full, 'l', 0.1, 0);
  assert.ok(Math.abs(edgeL.x - 0.1) < 1e-4);
  const edgeTr = applyCropDragDelta({ x: 0.1, y: 0.1, width: 0.5, height: 0.5 }, 'tr', 0.1, 0.1);
  assert.ok(Math.abs(edgeTr.width - 0.6) < 1e-4 && Math.abs(edgeTr.y - 0.2) < 1e-4);
  const edgeBl = applyCropDragDelta({ x: 0.2, y: 0.2, width: 0.5, height: 0.5 }, 'bl', -0.1, 0.1);
  assert.ok(Math.abs(edgeBl.x - 0.1) < 1e-4 && Math.abs(edgeBl.height - 0.6) < 1e-4);
});

test('T18.5: All 5 HTML motion templates build valid AnimationClips and .dmhtml documents passing ProjectValidator', () => {
  const clips = HTML_MOTION_TEMPLATES.map((t, idx) => {
    const doc = buildDmhtmlDocument(t.id, { title: t.defaultTitle, subtitle: t.defaultSubtitle, accent: t.defaultAccent });
    const meta = parseDmhtmlMeta(doc);
    assert.ok(meta && meta.templateId === t.id);

    return makeAnimationClip({
      timing: makeOverlayTiming(idx * 1.5, 2.5),
      sourcePath: `builtin://${t.id}`,
      position: makeNormalizedPoint(t.defaultX, t.defaultY),
      width: t.defaultWidth,
      properties: {
        template: { kind: 'string', value: t.id },
        title: { kind: 'string', value: t.defaultTitle },
        subtitle: { kind: 'string', value: t.defaultSubtitle },
        accent: { kind: 'string', value: t.defaultAccent },
      },
      layerIndex: idx + 1,
    });
  });

  const project = makeRecorderProject({
    timeline: makeProjectTimeline({ animationClips: clips }),
  });
  ProjectValidator.validate(project);
  assert.equal(project.timeline.animationClips.length, 5);
});
