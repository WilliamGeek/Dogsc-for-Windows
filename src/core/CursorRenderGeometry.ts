// Port of: F:\dogsc\Sources\RecorderCore\CursorRenderGeometry.swift
import { clamp, max, min } from './swift.ts';
import type { HexColor } from './HexColor.ts';
import type { CompositionPoint } from './CompositionScene.ts';
import type { CursorClickEffectStyle } from './ProjectModel.ts';

// ---------------------------------------------------------------------------
// CursorAssetPoint & CursorAssetSize
// ---------------------------------------------------------------------------
export interface CursorAssetPoint {
  x: number;
  y: number;
}

export function makeCursorAssetPoint(x: number, y: number): CursorAssetPoint {
  return { x, y };
}

export interface CursorAssetSize {
  width: number;
  height: number;
}

export function makeCursorAssetSize(width: number, height: number): CursorAssetSize {
  return { width, height };
}

// ---------------------------------------------------------------------------
// CursorAssetMetrics
// ---------------------------------------------------------------------------
/**
 * Rendering metadata shared by the editor preview and export compositor.
 * Hotspots use normalized image coordinates with a top-left origin.
 * Swift: `CursorAssetMetrics`.
 */
export interface CursorAssetMetrics {
  hotspot: CursorAssetPoint;
  intrinsicSize: CursorAssetSize;
  clickColor: HexColor;
  scaleReferenceHeight: number;
}

export function makeCursorAssetMetrics(options: {
  hotspot: CursorAssetPoint;
  intrinsicSize: CursorAssetSize;
  clickColor: HexColor;
  scaleReferenceHeight?: number | null;
}): CursorAssetMetrics {
  return {
    hotspot: options.hotspot,
    intrinsicSize: options.intrinsicSize,
    clickColor: options.clickColor,
    scaleReferenceHeight: options.scaleReferenceHeight ?? options.intrinsicSize.height,
  };
}

// ---------------------------------------------------------------------------
// CursorClickGeometryFrame
// ---------------------------------------------------------------------------
export interface CursorClickGeometryFrame {
  style: CursorClickEffectStyle;
  progress: number;

  // Primary outer ring / main shape
  primaryDiameter: number;
  primaryLineWidth: number;
  primaryOpacity: number;
  primaryIsFilled: boolean;
  primaryGlowRadius: number;

  // Secondary inner element (spark dot, inner ring, or glow core)
  secondaryDiameter: number;
  secondaryLineWidth: number;
  secondaryOpacity: number;
  secondaryIsFilled: boolean;
  secondaryGlowRadius: number;

  // Accent rays / burst
  accentOffset: number;
  accentSize: number;
  accentOpacity: number;

  // Maximum footprint diameter
  maxFootprintDiameter: number;
}

export function makeCursorClickGeometryFrame(options: {
  style: CursorClickEffectStyle;
  progress: number;
  primaryDiameter: number;
  primaryLineWidth: number;
  primaryOpacity: number;
  primaryIsFilled: boolean;
  primaryGlowRadius?: number;
  secondaryDiameter?: number;
  secondaryLineWidth?: number;
  secondaryOpacity?: number;
  secondaryIsFilled?: boolean;
  secondaryGlowRadius?: number;
  accentOffset?: number;
  accentSize?: number;
  accentOpacity?: number;
  maxFootprintDiameter?: number;
}): CursorClickGeometryFrame {
  const primaryGlowRadius = options.primaryGlowRadius ?? 0;
  const secondaryDiameter = options.secondaryDiameter ?? 0;
  const secondaryLineWidth = options.secondaryLineWidth ?? 0;
  const secondaryOpacity = options.secondaryOpacity ?? 0;
  const secondaryIsFilled = options.secondaryIsFilled ?? false;
  const secondaryGlowRadius = options.secondaryGlowRadius ?? 0;
  const accentOffset = options.accentOffset ?? 0;
  const accentSize = options.accentSize ?? 0;
  const accentOpacity = options.accentOpacity ?? 0;

  const rawMax = options.maxFootprintDiameter ?? 0;
  const maxFootprintDiameter =
    rawMax > 0
      ? rawMax
      : max(
          options.primaryDiameter + primaryGlowRadius * 2,
          secondaryDiameter + secondaryGlowRadius * 2,
          (accentOffset + accentSize) * 2,
        );

  return {
    style: options.style,
    progress: options.progress,
    primaryDiameter: options.primaryDiameter,
    primaryLineWidth: options.primaryLineWidth,
    primaryOpacity: options.primaryOpacity,
    primaryIsFilled: options.primaryIsFilled,
    primaryGlowRadius,
    secondaryDiameter,
    secondaryLineWidth,
    secondaryOpacity,
    secondaryIsFilled,
    secondaryGlowRadius,
    accentOffset,
    accentSize,
    accentOpacity,
    maxFootprintDiameter,
  };
}

// ---------------------------------------------------------------------------
// CursorRenderLayout
// ---------------------------------------------------------------------------
export interface CursorRenderLayout {
  /** Top-left image origin in the same coordinate space as the pointer. */
  origin: CompositionPoint;
  size: CursorAssetSize;
  pointer: CompositionPoint;
  clickDiameter: number;
  clickLineWidth: number;
  /** Click feedback keeps the user's chosen size when the cursor shape changes. */
  clickEffectHeight: number;
}

export function makeCursorRenderLayout(options: {
  origin: CompositionPoint;
  size: CursorAssetSize;
  pointer: CompositionPoint;
  clickDiameter: number;
  clickLineWidth: number;
  clickEffectHeight?: number | null;
}): CursorRenderLayout {
  return {
    origin: options.origin,
    size: options.size,
    pointer: options.pointer,
    clickDiameter: options.clickDiameter,
    clickLineWidth: options.clickLineWidth,
    clickEffectHeight: options.clickEffectHeight ?? options.size.height,
  };
}

// ---------------------------------------------------------------------------
// CursorRenderGeometry
// ---------------------------------------------------------------------------
export const CURSOR_RENDER_GEOMETRY_CANONICAL_HEIGHT = 44;
export const CURSOR_RENDER_GEOMETRY_CANONICAL_SHORT_EDGE = 1080;

export function cursorRenderGeometryLayout(
  pointer: CompositionPoint,
  canvasShortEdge: number,
  styleSize: number,
  metrics: CursorAssetMetrics,
): CursorRenderLayout | null {
  if (
    !Number.isFinite(pointer.x) ||
    !Number.isFinite(pointer.y) ||
    !Number.isFinite(canvasShortEdge) ||
    !(canvasShortEdge > 0) ||
    !Number.isFinite(metrics.hotspot.x) ||
    !Number.isFinite(metrics.hotspot.y) ||
    !Number.isFinite(metrics.intrinsicSize.width) ||
    !Number.isFinite(metrics.intrinsicSize.height) ||
    !(metrics.intrinsicSize.width > 0) ||
    !(metrics.intrinsicSize.height > 0) ||
    !Number.isFinite(metrics.scaleReferenceHeight) ||
    !(metrics.scaleReferenceHeight > 0)
  ) {
    return null;
  }

  const multiplier = clamp(styleSize, 0.25, 6);
  const referenceHeight = max(
    (canvasShortEdge * CURSOR_RENDER_GEOMETRY_CANONICAL_HEIGHT) /
      CURSOR_RENDER_GEOMETRY_CANONICAL_SHORT_EDGE *
      multiplier,
    1,
  );
  const imageScale = referenceHeight / metrics.scaleReferenceHeight;
  const height = metrics.intrinsicSize.height * imageScale;
  const width = metrics.intrinsicSize.width * imageScale;
  const hotspotX = clamp(metrics.hotspot.x, 0, 1);
  const hotspotY = clamp(metrics.hotspot.y, 0, 1);
  const lineWidth = max(
    referenceHeight * 0.08,
    (canvasShortEdge * 2) / CURSOR_RENDER_GEOMETRY_CANONICAL_SHORT_EDGE,
  );

  return {
    origin: {
      x: pointer.x - width * hotspotX,
      y: pointer.y - height * hotspotY,
    },
    size: { width, height },
    pointer,
    clickDiameter: referenceHeight * 1.45,
    clickLineWidth: lineWidth,
    clickEffectHeight: referenceHeight,
  };
}

export function cursorRenderGeometryClickGeometry(
  style: CursorClickEffectStyle,
  progress: number,
  baseHeight: number,
  opacityMultiplier: number = 1.0,
  scaleMultiplier: number = 1.0,
): CursorClickGeometryFrame | null {
  if (style === 'none' || progress < 0 || progress > 1 || !(baseHeight > 0)) {
    return null;
  }

  const userScale = clamp(scaleMultiplier, 0.4, 3.0);
  const userOpacity = clamp(opacityMultiplier, 0.05, 1.0);
  const scaledHeight = baseHeight * userScale;

  switch (style) {
    case 'ripple': {
      const e = 1.0 - Math.pow(1.0 - progress, 3.0);
      const primaryDiameter = scaledHeight * (0.45 + 1.45 * e);
      const primaryLineWidth = max(scaledHeight * (0.075 - 0.04 * progress), 1.2);
      const primaryOpacity = max(userOpacity * 0.95 * (1.0 - Math.pow(progress, 1.3)), 0);
      const primaryGlow = scaledHeight * 0.10 * (1.0 - progress);

      let secondaryDiameter: number;
      let secondaryOpacity: number;
      let secondaryIsFilled: boolean;
      let secondaryGlow: number;
      if (progress < 0.35) {
        const dotP = progress / 0.35;
        secondaryDiameter = scaledHeight * 0.28 * (1.0 - dotP);
        secondaryOpacity = max(userOpacity * 0.85 * (1.0 - dotP), 0);
        secondaryIsFilled = true;
        secondaryGlow = scaledHeight * 0.08 * (1.0 - dotP);
      } else {
        secondaryDiameter = 0;
        secondaryOpacity = 0;
        secondaryIsFilled = false;
        secondaryGlow = 0;
      }

      return makeCursorClickGeometryFrame({
        style: 'ripple',
        progress,
        primaryDiameter,
        primaryLineWidth,
        primaryOpacity,
        primaryIsFilled: false,
        primaryGlowRadius: primaryGlow,
        secondaryDiameter,
        secondaryLineWidth: 0,
        secondaryOpacity,
        secondaryIsFilled,
        secondaryGlowRadius: secondaryGlow,
        maxFootprintDiameter: scaledHeight * 2.2,
      });
    }

    case 'glow': {
      let primaryDiameter: number;
      let primaryOpacity: number;
      if (progress < 0.18) {
        const pBloom = progress / 0.18;
        primaryDiameter =
          scaledHeight * (0.75 + 0.50 * (1.0 - Math.pow(1.0 - pBloom, 2.0)));
        primaryOpacity = max(userOpacity * 0.78 * pBloom, 0);
      } else {
        const pFade = (progress - 0.18) / 0.82;
        primaryDiameter = scaledHeight * (1.25 + 0.55 * pFade);
        primaryOpacity = max(userOpacity * 0.78 * (1.0 - Math.pow(pFade, 1.4)), 0);
      }
      const primaryGlow = scaledHeight * 0.30;
      const secondaryDiameter = primaryDiameter * 0.50;
      const secondaryOpacity = primaryOpacity * 0.75;
      const secondaryGlow = scaledHeight * 0.18;

      return makeCursorClickGeometryFrame({
        style: 'glow',
        progress,
        primaryDiameter,
        primaryLineWidth: 0,
        primaryOpacity,
        primaryIsFilled: true,
        primaryGlowRadius: primaryGlow,
        secondaryDiameter,
        secondaryLineWidth: 0,
        secondaryOpacity,
        secondaryIsFilled: true,
        secondaryGlowRadius: secondaryGlow,
        maxFootprintDiameter: scaledHeight * 2.2,
      });
    }

    case 'pulse': {
      const e = 1.0 - Math.pow(1.0 - progress, 2.5);
      const primaryDiameter = scaledHeight * (0.50 + 1.25 * e);
      const primaryLineWidth = max(scaledHeight * 0.065, 1.2);
      const primaryOpacity = max(userOpacity * 0.90 * (1.0 - progress), 0);
      const primaryGlow = scaledHeight * 0.10 * (1.0 - progress);

      let secondaryDiameter: number;
      let secondaryLineWidth: number;
      let secondaryOpacity: number;
      let secondaryIsFilled: boolean;
      let secondaryGlow: number;
      if (progress <= 0.55) {
        const innerP = progress / 0.55;
        const innerE = Math.sin(innerP * Math.PI);
        secondaryDiameter = scaledHeight * (0.25 + 0.45 * innerE);
        secondaryLineWidth = 0;
        secondaryOpacity = max(userOpacity * 0.55 * (1.0 - innerP), 0);
        secondaryIsFilled = true;
        secondaryGlow = scaledHeight * 0.12 * (1.0 - innerP);
      } else {
        secondaryDiameter = 0;
        secondaryLineWidth = 0;
        secondaryOpacity = 0;
        secondaryIsFilled = false;
        secondaryGlow = 0;
      }

      return makeCursorClickGeometryFrame({
        style: 'pulse',
        progress,
        primaryDiameter,
        primaryLineWidth,
        primaryOpacity,
        primaryIsFilled: false,
        primaryGlowRadius: primaryGlow,
        secondaryDiameter,
        secondaryLineWidth,
        secondaryOpacity,
        secondaryIsFilled,
        secondaryGlowRadius: secondaryGlow,
        maxFootprintDiameter: scaledHeight * 2.0,
      });
    }

    case 'burst': {
      const primaryDiameter = max(scaledHeight * (0.35 - 0.18 * progress), 1.0);
      const primaryOpacity = max(userOpacity * 0.95 * (1.0 - Math.pow(progress, 2.0)), 0);
      const primaryGlow = scaledHeight * 0.14 * (1.0 - progress);

      const secondaryDiameter = scaledHeight * (0.45 + 0.55 * progress);
      const secondaryLineWidth = max(scaledHeight * 0.035, 1.0);
      const secondaryOpacity = max(userOpacity * 0.55 * (1.0 - progress), 0);
      const secondaryGlow = scaledHeight * 0.08 * (1.0 - progress);

      const burstE = 1.0 - Math.pow(1.0 - progress, 2.0);
      const accentOffset = scaledHeight * (0.28 + 0.38 * burstE);
      const accentSize = max(scaledHeight * 0.075 * (1.0 - progress), 1.2);
      const accentOpacity = max(userOpacity * 0.85 * (1.0 - progress), 0);

      return makeCursorClickGeometryFrame({
        style: 'burst',
        progress,
        primaryDiameter,
        primaryLineWidth: 0,
        primaryOpacity,
        primaryIsFilled: true,
        primaryGlowRadius: primaryGlow,
        secondaryDiameter,
        secondaryLineWidth,
        secondaryOpacity,
        secondaryIsFilled: false,
        secondaryGlowRadius: secondaryGlow,
        accentOffset,
        accentSize,
        accentOpacity,
        maxFootprintDiameter: scaledHeight * 1.8,
      });
    }

    case 'none':
      return null;
  }
}

export const CURSOR_RENDER_GEOMETRY_PRESS_IN_DURATION = 0.08;
export const CURSOR_RENDER_GEOMETRY_PRESS_RELEASE_DURATION = 0.18;
export const CURSOR_RENDER_GEOMETRY_PRESS_DURATION =
  CURSOR_RENDER_GEOMETRY_PRESS_IN_DURATION + CURSOR_RENDER_GEOMETRY_PRESS_RELEASE_DURATION;
export const CURSOR_RENDER_GEOMETRY_PRESSED_SCALE = 0.82;

export function cursorRenderGeometryPressScale(elapsed: number): number {
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= CURSOR_RENDER_GEOMETRY_PRESS_DURATION) {
    return 1;
  }
  const depth = 1 - CURSOR_RENDER_GEOMETRY_PRESSED_SCALE;
  if (elapsed < CURSOR_RENDER_GEOMETRY_PRESS_IN_DURATION) {
    const p = elapsed / CURSOR_RENDER_GEOMETRY_PRESS_IN_DURATION;
    const eased = 1 - (1 - p) * (1 - p);
    return 1 - depth * eased;
  }
  const p =
    (elapsed - CURSOR_RENDER_GEOMETRY_PRESS_IN_DURATION) /
    CURSOR_RENDER_GEOMETRY_PRESS_RELEASE_DURATION;
  const overshoot = 1.2;
  const q = p - 1;
  const back = 1 + (overshoot + 1) * q * q * q + overshoot * q * q;
  return CURSOR_RENDER_GEOMETRY_PRESSED_SCALE + depth * back;
}

export const CursorRenderGeometry = Object.freeze({
  canonicalHeight: CURSOR_RENDER_GEOMETRY_CANONICAL_HEIGHT,
  canonicalShortEdge: CURSOR_RENDER_GEOMETRY_CANONICAL_SHORT_EDGE,
  pressInDuration: CURSOR_RENDER_GEOMETRY_PRESS_IN_DURATION,
  pressReleaseDuration: CURSOR_RENDER_GEOMETRY_PRESS_RELEASE_DURATION,
  pressDuration: CURSOR_RENDER_GEOMETRY_PRESS_DURATION,
  pressedScale: CURSOR_RENDER_GEOMETRY_PRESSED_SCALE,
  pressScale: cursorRenderGeometryPressScale,
  layout: cursorRenderGeometryLayout,
  clickGeometry: cursorRenderGeometryClickGeometry,
});
