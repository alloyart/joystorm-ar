"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type {
  FaceLandmarker,
  FaceLandmarkerResult,
  NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import {
  advanceExpressionState,
  combineLaughSmile,
  combineSmileSides,
  createExpressionTracker,
  EXPRESSION_CONFIG,
  getExpressionThresholds,
  isLaughPreemptCandidate,
  normalizeLaughIntensity,
  normalizeSmileIntensity,
} from "./expression-engine.mjs";
import {
  advanceNeutralCalibration,
  createCameraStartupGate,
  deactivateCameraRuntime,
  finalizeCameraStartup,
  listenForPageHidden,
  neutralCalibrationPrompt,
  releaseCameraResources,
} from "./camera-runtime.mjs";
import {
  collideFireworkParticle,
  mapCoverLandmark,
  smoothHeadCollider,
} from "./firework-collision.mjs";
import { zhCN } from "./zh-CN";

function publicAssetPath(path: string): string {
  if (typeof document === "undefined") return path;
  const basePath = document.documentElement.dataset.assetBase ?? "";
  return `${basePath}${path}`;
}

type EngineState = "idle" | "loading" | "live" | "demo" | "error";
type Expression = "neutral" | "smile" | "laugh";
type ParticleKind =
  | "rain"
  | "star"
  | "letter"
  | "drift"
  | "rocket"
  | "firework";
type FallingKind = "rain" | "star" | "letter";
type FireworkLayer = "primary" | "secondary" | "residual";

type TrailPoint = {
  x: number;
  y: number;
};

type FireworkDebugTarget = {
  x: number;
  y: number;
  collisionEnabled: boolean;
};

type FireworkCollisionEvent = {
  particleId: number;
  contactX: number;
  contactY: number;
  normalX: number;
  normalY: number;
  timestamp: number;
  burstId: number;
};

type MiniFireworkSeed = FireworkCollisionEvent & {
  hue: number;
};

type CollisionEvidenceFlash = {
  active: boolean;
  x: number;
  y: number;
  age: number;
  duration: number;
};

type CollisionAudit = {
  currentBurstId: number;
  currentBurstCollisions: number;
  sessionCollisions: number;
  lastCollisionAt: number | null;
  lastEvent: FireworkCollisionEvent | null;
};

type HeadCollider = {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rotation: number;
  visible: boolean;
};

type Particle = {
  particleId?: number;
  burstId?: number;
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  maxLife: number;
  hue: number;
  gravity: number;
  drag: number;
  bounces: number;
  groundY?: number;
  targetY?: number;
  burstSize?: number;
  delay?: number;
  fadeStartedAt?: number;
  fadeDurationMs?: number;
  glyph?: string;
  sourceKind?: FallingKind;
  rotation?: number;
  spin?: number;
  curve?: number;
  brightness?: number;
  saturation?: number;
  trailLength?: number;
  trail?: TrailPoint[];
  trailCapacity?: number;
  starMorphStart?: number;
  burstRadius?: number;
  burstRateVariation?: number;
  burstRole?: "main" | "satellite";
  fireworkLayer?: FireworkLayer;
  lateDrag?: number;
  gravityDelay?: number;
  gravityRamp?: number;
  fadeStart?: number;
  flickerPhase?: number;
  turbulence?: number;
  collidesWithHead?: boolean;
  previousX?: number;
  previousY?: number;
  collisionArmed?: boolean;
  collisionCooldown?: number;
  collisionEventRecorded?: boolean;
  collisionResponse?: "miniBurst";
  fireworkDecoration?: "star" | "letter";
};

type Ripple = {
  active: boolean;
  x: number;
  y: number;
  age: number;
  duration: number;
  radius: number;
  hue: number;
  rings: 2 | 3;
};

type BurstRing = {
  active: boolean;
  x: number;
  y: number;
  age: number;
  duration: number;
  radius: number;
  hue: number;
};

type ImpactMatrix = {
  active: boolean;
  x: number;
  y: number;
  age: number;
  duration: number;
  radius: number;
  hue: number;
  phase: number;
};

type Telemetry = {
  smile: number;
  jaw: number;
  rawSmile: number;
  smileLeft: number;
  smileRight: number;
  rawJaw: number;
  cheekSquint: number;
  laughSmile: number;
  laughIntensity: number;
  fps: number;
  inferenceFps: number;
  particles: number;
  rainParticles: number;
  fireworkParticles: number;
  ripples: number;
  face: boolean;
  smileThreshold: number;
  smileExitThreshold: number;
  laughSmileThreshold: number;
  laughSmileExitThreshold: number;
  laughJawThreshold: number;
  laughJawExitThreshold: number;
  candidateState: Expression;
  stableState: Expression;
  candidateDurationMs: number;
  rainEmission: boolean;
  rainIntensity: number;
  cooldownMs: number;
  currentBurstCollisions: number;
  sessionCollisions: number;
  lastCollisionAgeMs: number | null;
  colliderTracked: boolean;
  collisionEnabled: boolean;
};

const EMPTY_TELEMETRY: Telemetry = {
  smile: 0,
  jaw: 0,
  rawSmile: 0,
  smileLeft: 0,
  smileRight: 0,
  rawJaw: 0,
  cheekSquint: 0,
  laughSmile: 0,
  laughIntensity: 0,
  fps: 60,
  inferenceFps: 13,
  particles: 0,
  rainParticles: 0,
  fireworkParticles: 0,
  ripples: 0,
  face: false,
  smileThreshold: 0.06,
  smileExitThreshold: 0.045,
  laughSmileThreshold: 0.48,
  laughSmileExitThreshold: 0.36,
  laughJawThreshold: 0.28,
  laughJawExitThreshold: 0.19,
  candidateState: "neutral",
  stableState: "neutral",
  candidateDurationMs: 0,
  rainEmission: false,
  rainIntensity: 0,
  cooldownMs: 0,
  currentBurstCollisions: 0,
  sessionCollisions: 0,
  lastCollisionAgeMs: null,
  colliderTracked: false,
  collisionEnabled: true,
};

const PARTICLE_BUDGET = { auto: 400, high: 460, lite: 280 } as const;
const MAX_RIPPLES = 40;
const MAX_BURST_RINGS = 9;
const MAX_IMPACT_MATRICES = 16;
const MAX_COLLISION_EVIDENCE_FLASHES = 24;
const MAX_MINI_FIREWORK_BURSTS_PER_FRAME = 4;
const MINI_FIREWORK_PARTICLE_COUNT = 20;
const COLLISION_EVIDENCE_DURATION_MS = 110;
const DETECTION_INTERVAL_MS = 80;
const LAUGH_DETECTION_INTERVAL_MS = 110;
const RAIN_FADE_MS = 300;
const FIREWORK_SUSTAIN_INTERVAL_MS = 820;
const FIREWORK_SUSTAIN_INTERVAL_LITE_MS = 1080;
const GLYPHS = ["S", "M", "I", "L", "E"] as const;
const LAUGH_GLYPHS = ["l", "a", "u", "g", "h"] as const;
const EFFECT_DECORATION_SIZE_MIN = 3.8;
const EFFECT_DECORATION_SIZE_RANGE = 3;
const FIREWORK_MAIN_DENSITY = 3.25;
const FIREWORK_LAYER_RATIO = {
  primary: 0.44,
  secondary: 0.4,
  residual: 0.16,
} as const;

// 调试入口保留但默认关闭；改为 true 可重新启用“点击 → 单朵烟花”。
const FIREWORK_DEBUG_MODE = false;
// 调试模式重新开启时默认测试现有头部碰撞，不会停止人脸检测。
const FIREWORK_DEBUG_COLLISION = true;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const progress = clamp((value - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
  return progress * progress * (3 - 2 * progress);
}

function centeredRandom() {
  return (Math.random() + Math.random() + Math.random()) / 3 - 0.5;
}

function fireworkColor(layer: FireworkLayer, baseHue: number) {
  const hueJitter =
    layer === "primary" ? 7 : layer === "secondary" ? 10 : 14;
  const saturationFloor =
    layer === "primary" ? 96 : layer === "secondary" ? 94 : 92;
  return {
    hue: (baseHue + centeredRandom() * hueJitter + 360) % 360,
    saturation:
      saturationFloor + Math.random() * (100 - saturationFloor),
  };
}

function blendshapeScore(result: FaceLandmarkerResult, names: string[]) {
  const categories = result.faceBlendshapes[0]?.categories ?? [];
  let total = 0;
  let count = 0;
  for (const name of names) {
    const category = categories.find((item) => item.categoryName === name);
    if (category) {
      total += category.score;
      count += 1;
    }
  }
  return count ? total / count : 0;
}

function createRipplePool(): Ripple[] {
  return Array.from({ length: MAX_RIPPLES }, () => ({
    active: false,
    x: 0,
    y: 0,
    age: 0,
    duration: 720,
    radius: 28,
    hue: 198,
    rings: 2,
  }));
}

function createBurstRingPool(): BurstRing[] {
  return Array.from({ length: MAX_BURST_RINGS }, () => ({
    active: false,
    x: 0,
    y: 0,
    age: 0,
    duration: 940,
    radius: 220,
    hue: 198,
  }));
}

function createImpactMatrixPool(): ImpactMatrix[] {
  return Array.from({ length: MAX_IMPACT_MATRICES }, () => ({
    active: false,
    x: 0,
    y: 0,
    age: 0,
    duration: 920,
    radius: 52,
    hue: 202,
    phase: 0,
  }));
}

function createCollisionEvidencePool(): CollisionEvidenceFlash[] {
  return Array.from({ length: MAX_COLLISION_EVIDENCE_FLASHES }, () => ({
    active: false,
    x: 0,
    y: 0,
    age: 0,
    duration: COLLISION_EVIDENCE_DURATION_MS,
  }));
}

function resetCollisionEvidencePool(pool: CollisionEvidenceFlash[]) {
  for (const flash of pool) {
    flash.active = false;
    flash.age = 0;
  }
}

function activateCollisionEvidenceFlash(
  pool: CollisionEvidenceFlash[],
  event: FireworkCollisionEvent,
) {
  const flash =
    pool.find((item) => !item.active) ??
    pool.reduce((oldest, item) =>
      item.age > oldest.age ? item : oldest,
    );
  flash.active = true;
  flash.x = event.contactX;
  flash.y = event.contactY;
  flash.age = 0;
  flash.duration = COLLISION_EVIDENCE_DURATION_MS;
}

function activateImpactMatrix(
  pool: ImpactMatrix[],
  x: number,
  y: number,
  width: number,
  intensity: number,
) {
  const matrix =
    pool.find((item) => !item.active) ??
    pool.reduce((oldest, item) => (item.age > oldest.age ? item : oldest));
  matrix.active = true;
  matrix.x = x;
  matrix.y = y;
  matrix.age = 0;
  matrix.duration = 760 + Math.random() * 320;
  matrix.radius = clamp(
    width * (0.036 + intensity * 0.018 + Math.random() * 0.012),
    26,
    76,
  );
  matrix.hue = 190 + Math.random() * 24;
  matrix.phase = Math.random() * Math.PI * 2;
}

function activateBurstRing(
  pool: BurstRing[],
  x: number,
  y: number,
  radius: number,
  hue: number,
) {
  const ring =
    pool.find((item) => !item.active) ??
    pool.reduce((oldest, item) => (item.age > oldest.age ? item : oldest));
  ring.active = true;
  ring.x = x;
  ring.y = y;
  ring.age = 0;
  ring.duration = 420 + Math.random() * 140;
  ring.radius = radius;
  ring.hue = hue;
}

function activateRipple(pool: Ripple[], x: number, y: number, width: number) {
  const ripple =
    pool.find((item) => !item.active) ??
    pool.reduce((oldest, item) => (item.age > oldest.age ? item : oldest));
  ripple.active = true;
  ripple.x = x;
  ripple.y = y;
  ripple.age = 0;
  ripple.duration = 620 + Math.random() * 260;
  ripple.radius = clamp(width * (0.025 + Math.random() * 0.02), 18, 56);
  ripple.hue = 190 + Math.random() * 18;
  ripple.rings = Math.random() > 0.54 ? 3 : 2;
}

function explodeRocket(
  rocket: Particle,
  particles: Particle[],
  rings: BurstRing[],
  particleLimit: number,
  canvasWidth: number,
) {
  const satellite = rocket.burstRole === "satellite";
  const requestedCount = rocket.burstSize ?? 72;
  const count = satellite
    ? requestedCount
    : Math.round(requestedCount * FIREWORK_MAIN_DENSITY);
  const available = Math.max(0, particleLimit - particles.length);
  const actualCount = Math.min(count, available);
  const radius = clamp(
    rocket.burstRadius ?? canvasWidth * 0.19,
    canvasWidth * (satellite ? 0.052 : 0.12),
    canvasWidth * (satellite ? 0.13 : 0.37),
  );
  activateBurstRing(
    rings,
    rocket.x,
    rocket.y,
    radius,
    rocket.hue,
  );
  const primaryCount = Math.round(
    actualCount * (satellite ? 0.62 : FIREWORK_LAYER_RATIO.primary),
  );
  const secondaryCount = Math.round(
    actualCount * (satellite ? 0.3 : FIREWORK_LAYER_RATIO.secondary),
  );
  const clusterCount = satellite ? 9 : 28;
  const clusterPhase = Math.random() * Math.PI * 2;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const sizeProgress = satellite
    ? 0
    : clamp((radius / canvasWidth - 0.15) / 0.22, 0, 1);
  const previousPeakSpeed = clamp(canvasWidth * 0.37 / 42, 5.2, 11.2);
  const burstRateVariation = rocket.burstRateVariation ?? 1;
  const radiusSpeed = (satellite
    ? clamp(radius / 42, 2.7, 11.2) * 1.18
    : previousPeakSpeed * (1.22 - sizeProgress * 0.14)) *
    burstRateVariation;
  const burstTempo =
    (satellite ? 1.24 : 1.28 - sizeProgress * 0.16) *
    burstRateVariation;
  const lifeScale = satellite ? 0.94 : 0.94 + sizeProgress * 0.34;

  for (let index = 0; index < actualCount; index += 1) {
    const layer: FireworkLayer =
      index < primaryCount
        ? "primary"
        : index < primaryCount + secondaryCount
          ? "secondary"
          : "residual";
    const layerIndex =
      layer === "primary"
        ? index
        : layer === "secondary"
          ? index - primaryCount
          : index - primaryCount - secondaryCount;
    const clusterIndex = layerIndex % clusterCount;
    const clusterAngle =
      clusterPhase + (clusterIndex / clusterCount) * Math.PI * 2;
    const stratifiedAngle = clusterPhase + layerIndex * goldenAngle;
    const usesLocalBundle = layerIndex % 5 < 2;
    const angleSpread =
      layer === "primary" ? 0.36 : layer === "secondary" ? 0.56 : 0.78;
    const angle =
      (usesLocalBundle ? clusterAngle : stratifiedAngle) +
      centeredRandom() * angleSpread;
    const speedScale =
      layer === "primary"
        ? 0.72 + Math.random() * 0.58
        : layer === "secondary"
          ? 0.3 + Math.random() * 0.58
          : 0.12 + Math.random() * 0.36;
    const speed = radiusSpeed * speedScale;
    const baseLife = satellite
      ? layer === "primary"
        ? 88 + Math.random() * 38
        : 76 + Math.random() * 34
      : layer === "primary"
        ? 160 + Math.random() * 58
        : layer === "secondary"
          ? 128 + Math.random() * 48
          : 98 + Math.random() * 48;
    const life = baseLife * lifeScale;
    const baseDrag =
      layer === "primary"
        ? 0.964 + Math.random() * 0.01
        : layer === "secondary"
          ? 0.958 + Math.random() * 0.012
          : 0.97 + Math.random() * 0.009;
    const baseLateDrag =
      layer === "primary"
        ? 0.993 + Math.random() * 0.0015
        : layer === "secondary"
          ? 0.9915 + Math.random() * 0.002
          : 0.994 + Math.random() * 0.0015;
    const color = fireworkColor(layer, rocket.hue);
    const fireworkDecoration =
      layer === "residual"
        ? layerIndex % 3 === 1
          ? "letter"
          : "star"
        : undefined;
    const fireworkGlyph =
      fireworkDecoration === "letter"
        ? LAUGH_GLYPHS[Math.floor(layerIndex / 3) % LAUGH_GLYPHS.length]
        : undefined;
    const decorationCollisionEnabled =
      fireworkDecoration === "star" &&
      (rocket.collidesWithHead !== false || satellite);
    const baseDelay =
      layer === "primary"
        ? Math.random() * (satellite ? 1.2 : 1.8)
        : layer === "secondary"
          ? 3 + Math.random() * (satellite ? 6 : 10)
          : 12 + Math.random() * (satellite ? 9 : 20);
    const delay = baseDelay / burstTempo;
    const trailCapacity = satellite
      ? layer === "primary"
        ? 8
        : 5
      : layer === "primary"
        ? 10 + Math.floor(Math.random() * 4)
        : layer === "secondary"
          ? 5 + Math.floor(Math.random() * 4)
          : 2 + Math.floor(Math.random() * 3);
    particles.push({
      particleId: (rocket.particleId ?? 0) * 1000 + index,
      burstId: rocket.burstId,
      kind: "firework",
      x: rocket.x + centeredRandom() * (layer === "primary" ? 2.2 : 5.6),
      y: rocket.y + centeredRandom() * (layer === "primary" ? 2.2 : 5.6),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size:
        fireworkDecoration
          ? EFFECT_DECORATION_SIZE_MIN +
            Math.random() * EFFECT_DECORATION_SIZE_RANGE
          : layer === "primary"
          ? (satellite ? 0.72 : 0.86) + Math.random() * 0.62
          : layer === "secondary"
            ? 0.48 + Math.random() * 0.38
            : 0.36 + Math.random() * 0.3,
      life,
      maxLife: life,
      hue: color.hue,
      saturation: color.saturation,
      glyph: fireworkGlyph,
      fireworkDecoration,
      gravity:
        layer === "primary"
          ? 0.047 + Math.random() * 0.012
          : layer === "secondary"
            ? 0.052 + Math.random() * 0.014
            : 0.058 + Math.random() * 0.016,
      drag: baseDrag + (1 - baseDrag) * sizeProgress * 0.52,
      lateDrag:
        baseLateDrag + (1 - baseLateDrag) * sizeProgress * 0.58,
      gravityDelay:
        layer === "primary"
          ? 0.34 + Math.random() * 0.12
          : layer === "secondary"
            ? 0.28 + Math.random() * 0.12
            : 0.22 + Math.random() * 0.12,
      gravityRamp: 0.2 + Math.random() * 0.12,
      bounces: 0,
      curve:
        (index % 2 === 0 ? 1 : -1) *
        (layer === "primary"
          ? 0.0006 + Math.random() * 0.0023
          : 0.0014 + Math.random() * 0.0042),
      brightness:
        layer === "primary"
          ? 68 + Math.random() * 12
          : layer === "secondary"
            ? 64 + Math.random() * 14
            : 60 + Math.random() * 16,
      trail: [],
      trailCapacity,
      starMorphStart:
        layer === "residual"
          ? 0.46 + Math.random() * 0.08
          : 0.9 + Math.random() * 0.08,
      fadeStart:
        layer === "primary"
          ? 0.54 + Math.random() * 0.14
          : layer === "secondary"
            ? 0.43 + Math.random() * 0.16
            : 0.82 + Math.random() * 0.08,
      flickerPhase: Math.random() * Math.PI * 2,
      turbulence:
        layer === "primary"
          ? 0.002 + Math.random() * 0.003
          : 0.003 + Math.random() * 0.006,
      delay,
      rotation: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.022,
      burstRole: rocket.burstRole,
      fireworkLayer: layer,
      collidesWithHead:
        decorationCollisionEnabled ? true : rocket.collidesWithHead,
      collisionResponse:
        decorationCollisionEnabled ? "miniBurst" : undefined,
      collisionArmed: decorationCollisionEnabled ? true : undefined,
    });
  }
}

function appendMiniFireworkBurst(
  seed: MiniFireworkSeed,
  particles: Particle[],
  particleLimit: number,
  firstParticleId: number,
) {
  const count = Math.min(
    MINI_FIREWORK_PARTICLE_COUNT,
    Math.max(0, particleLimit - particles.length),
  );
  const phase = ((seed.particleId % 17) / 17) * Math.PI * 2;
  for (let index = 0; index < count; index += 1) {
    const angle = phase + (index / Math.max(1, count)) * Math.PI * 2;
    const speed = 1.9 + (index % 5) * 0.34 + Math.random() * 0.32;
    const life = 58 + Math.random() * 28;
    particles.push({
      particleId: firstParticleId + index,
      burstId: seed.burstId,
      kind: "firework",
      x: seed.contactX + seed.normalX * 2,
      y: seed.contactY + seed.normalY * 2,
      vx: Math.cos(angle) * speed + seed.normalX * 0.28,
      vy: Math.sin(angle) * speed + seed.normalY * 0.28,
      size: 0.64 + Math.random() * 0.34,
      life,
      maxLife: life,
      hue: (seed.hue + centeredRandom() * 8 + 360) % 360,
      saturation: 96 + Math.random() * 4,
      brightness: 72 + Math.random() * 12,
      gravity: 0.046 + Math.random() * 0.01,
      drag: 0.964 + Math.random() * 0.008,
      lateDrag: 0.992,
      gravityDelay: 0.18,
      gravityRamp: 0.18,
      bounces: 0,
      curve: (index % 2 === 0 ? 1 : -1) * 0.002,
      trail: [],
      trailCapacity: 3,
      starMorphStart: 0.98,
      fadeStart: 0.38 + Math.random() * 0.1,
      flickerPhase: Math.random() * Math.PI * 2,
      turbulence: 0.002,
      rotation: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.03,
      burstRole: "satellite",
      fireworkLayer: "secondary",
      collidesWithHead: false,
    });
  }
  return count;
}

function drawStar(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  rotation: number,
) {
  context.moveTo(
    x + Math.cos(rotation) * radius,
    y + Math.sin(rotation) * radius,
  );
  for (let point = 1; point <= 8; point += 1) {
    const angle = rotation + (point * Math.PI) / 4;
    const length = point % 2 === 0 ? radius : radius * 0.25;
    context.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
  }
  context.closePath();
}

function drawFireworkTrail(
  context: CanvasRenderingContext2D,
  particle: Particle,
  dpr: number,
  alpha: number,
  brightness: number,
) {
  const trail = particle.trail;
  if (!trail || trail.length < 2) return;

  const saturation = particle.saturation ?? 88;
  const layer = particle.fireworkLayer ?? "primary";
  const previousLineCap = context.lineCap;
  context.lineCap = "round";

  let fromX = trail[0].x;
  let fromY = trail[0].y;
  for (let index = 1; index <= trail.length; index += 1) {
    const point = index === trail.length ? particle : trail[index];
    const headWeight = index / trail.length;
    const segmentAlpha = Math.pow(headWeight, 1.55);
    context.beginPath();
    context.moveTo(fromX, fromY);
    context.lineTo(point.x, point.y);
    context.strokeStyle = `hsla(${particle.hue}, ${saturation}%, ${Math.min(82, brightness + 4)}%, ${alpha * segmentAlpha * (layer === "primary" ? 0.32 : 0.2)})`;
    context.lineWidth =
      Math.max(
        0.42,
        particle.size *
          (layer === "primary"
            ? 0.68 + headWeight * 0.42
            : 0.5 + headWeight * 0.28),
      ) * dpr;
    context.stroke();

    context.beginPath();
    context.moveTo(fromX, fromY);
    context.lineTo(point.x, point.y);
    context.strokeStyle = `hsla(${particle.hue}, ${Math.min(64, saturation)}%, 98%, ${alpha * segmentAlpha * (0.04 + headWeight * 0.22)})`;
    context.lineWidth =
      Math.max(0.28, particle.size * (0.2 + headWeight * 0.22)) * dpr;
    context.stroke();
    fromX = point.x;
    fromY = point.y;
  }

  context.lineCap = previousLineCap;
}

function colliderFromLandmarks(
  landmarks: NormalizedLandmark[],
  width: number,
  height: number,
  videoWidth: number,
  videoHeight: number,
  previous: HeadCollider,
): HeadCollider | null {
  const left = landmarks[234];
  const right = landmarks[454];
  const top = landmarks[10];
  const chin = landmarks[152];
  if (!left || !right || !top || !chin) return null;

  const mappedLeft = mapCoverLandmark({
    x: left.x,
    y: left.y,
    canvasWidth: width,
    canvasHeight: height,
    videoWidth,
    videoHeight,
  });
  const mappedRight = mapCoverLandmark({
    x: right.x,
    y: right.y,
    canvasWidth: width,
    canvasHeight: height,
    videoWidth,
    videoHeight,
  });
  const mappedTop = mapCoverLandmark({
    x: top.x,
    y: top.y,
    canvasWidth: width,
    canvasHeight: height,
    videoWidth,
    videoHeight,
  });
  const mappedChin = mapCoverLandmark({
    x: chin.x,
    y: chin.y,
    canvasWidth: width,
    canvasHeight: height,
    videoWidth,
    videoHeight,
  });
  const cheekSpan = Math.hypot(
    mappedRight.x - mappedLeft.x,
    mappedRight.y - mappedLeft.y,
  );
  const faceHeight = Math.hypot(
    mappedChin.x - mappedTop.x,
    mappedChin.y - mappedTop.y,
  );
  let rotation = Math.atan2(
    mappedRight.y - mappedLeft.y,
    mappedRight.x - mappedLeft.x,
  );
  while (rotation > Math.PI / 2) rotation -= Math.PI;
  while (rotation <= -Math.PI / 2) rotation += Math.PI;

  const rawCollider: HeadCollider = {
    cx: (mappedLeft.x + mappedRight.x + mappedTop.x + mappedChin.x) / 4,
    cy: (mappedTop.y + mappedChin.y) / 2 - faceHeight * 0.025,
    rx: Math.max(width * 0.055, cheekSpan * 0.62),
    ry: Math.max(height * 0.075, faceHeight * 0.7),
    rotation,
    visible: true,
  };
  return smoothHeadCollider(previous, rawCollider) as HeadCollider;
}

function collideParticle(
  particle: Particle,
  head: HeadCollider,
  onCollision?: (event: FireworkCollisionEvent) => void,
  timestamp = 0,
) {
  return collideFireworkParticle(particle, head, onCollision, timestamp);
}

function Meter({ value, label }: { value: number; label: string }) {
  return (
    <div className="meter" aria-label={`${label} ${Math.round(value * 100)}%`}>
      <div className="meter-label">
        <span>{label}</span>
        <span>{Math.round(value * 100)}</span>
      </div>
      <div className="meter-track">
        <span style={{ width: `${clamp(value, 0, 1) * 100}%` }} />
      </div>
    </div>
  );
}

function expressionLabel(value: Expression) {
  if (value === "laugh") return zhCN.signal.laugh;
  if (value === "smile") return zhCN.signal.smile;
  return zhCN.signal.neutral;
}

export default function Home() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const cameraStartupGateRef = useRef(createCameraStartupGate());
  const animationRef = useRef<number | null>(null);
  const drawFrameRef = useRef<(now: number) => void>(() => undefined);
  const particlesRef = useRef<Particle[]>([]);
  const ripplesRef = useRef<Ripple[]>(createRipplePool());
  const burstRingsRef = useRef<BurstRing[]>(createBurstRingPool());
  const impactMatricesRef = useRef<ImpactMatrix[]>(createImpactMatrixPool());
  const headRef = useRef<HeadCollider>({
    cx: 0,
    cy: 0,
    rx: 80,
    ry: 110,
    rotation: 0,
    visible: false,
  });
  const expressionRef = useRef<Expression>("neutral");
  const smoothedRef = useRef({ smile: 0, jaw: 0, cheek: 0 });
  const baselineRef = useRef({ smile: 0, jaw: 0, cheek: 0, samples: 0 });
  const trackerRef = useRef(createExpressionTracker());
  const expressionDiagnosticsRef = useRef({
    rawSmile: 0,
    smileLeft: 0,
    smileRight: 0,
    rawJaw: 0,
    cheekSquint: 0,
    smile: 0,
    jaw: 0,
    laughSmile: 0,
    laughIntensity: 0,
    candidateState: "neutral" as Expression,
    candidateDurationMs: 0,
    faceTracked: false,
    thresholds: getExpressionThresholds({ smile: 0, jaw: 0 }),
  });
  const lastDetectionRef = useRef(0);
  const detectionIntervalRef = useRef(DETECTION_INTERVAL_MS);
  const lastLaughRef = useRef(-Infinity);
  const pendingLaughTriggerRef = useRef(false);
  const laughEmissionRef = useRef(false);
  const nextLaughFireworkAtRef = useRef(0);
  const laughIntensityRef = useRef(0);
  const rainSuppressedForLaughRef = useRef(false);
  const rainIntensityRef = useRef(0);
  const fireworkSequenceRef = useRef(0);
  const glyphIndexRef = useRef(0);
  const smileResumeAtRef = useRef(0);
  const lastFrameRef = useRef(0);
  const lastTelemetryRef = useRef(0);
  const frameStatsRef = useRef({ elapsed: 0, frames: 0, fps: 60 });
  const collisionFlashRef = useRef(0);
  const collisionEvidenceRef = useRef<CollisionEvidenceFlash[]>(
    createCollisionEvidencePool(),
  );
  const collisionAuditRef = useRef<CollisionAudit>({
    currentBurstId: 0,
    currentBurstCollisions: 0,
    sessionCollisions: 0,
    lastCollisionAt: null,
    lastEvent: null,
  });
  const nextBurstIdRef = useRef(1);
  const nextParticleIdRef = useRef(1);
  const debugModeRef = useRef(FIREWORK_DEBUG_MODE);
  const debugCollisionRef = useRef(FIREWORK_DEBUG_COLLISION);
  const showHeadColliderRef = useRef(false);
  const showCollisionEvidenceRef = useRef(false);

  const [engineState, setEngineState] = useState<EngineState>("idle");
  const [expression, setExpression] = useState<Expression>("neutral");
  const [telemetry, setTelemetry] = useState<Telemetry>(EMPTY_TELEMETRY);
  const [errorMessage, setErrorMessage] = useState("");
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [quality, setQuality] = useState<"auto" | "high" | "lite">("auto");
  const [eventMessage, setEventMessage] = useState(zhCN.events.waiting);
  const [debugModeEnabled, setDebugModeEnabled] = useState(
    FIREWORK_DEBUG_MODE,
  );
  const [debugCollisionEnabled, setDebugCollisionEnabled] = useState(
    FIREWORK_DEBUG_COLLISION,
  );
  const [showHeadCollider, setShowHeadCollider] = useState(false);
  const [showCollisionEvidence, setShowCollisionEvidence] = useState(false);

  const resetCollisionSession = () => {
    collisionAuditRef.current = {
      currentBurstId: 0,
      currentBurstCollisions: 0,
      sessionCollisions: 0,
      lastCollisionAt: null,
      lastEvent: null,
    };
    nextBurstIdRef.current = 1;
    nextParticleIdRef.current = 1;
    resetCollisionEvidencePool(collisionEvidenceRef.current);
  };

  const disableCollisionDebug = () => {
    debugModeRef.current = false;
    debugCollisionRef.current = FIREWORK_DEBUG_COLLISION;
    showHeadColliderRef.current = false;
    showCollisionEvidenceRef.current = false;
    resetCollisionEvidencePool(collisionEvidenceRef.current);
    setDebugModeEnabled(false);
    setDebugCollisionEnabled(FIREWORK_DEBUG_COLLISION);
    setShowHeadCollider(false);
    setShowCollisionEvidence(false);
  };

  const recordCollisionEvidence = useCallback(
    (event: FireworkCollisionEvent) => {
      const audit = collisionAuditRef.current;
      if (event.burstId === audit.currentBurstId) {
        audit.currentBurstCollisions += 1;
      }
      audit.sessionCollisions += 1;
      audit.lastCollisionAt = event.timestamp;
      audit.lastEvent = event;
    },
    [],
  );

  const updateExpression = useCallback((next: Expression) => {
    if (expressionRef.current === next) return;
    expressionRef.current = next;
    setExpression(next);
    setEventMessage(
      next === "laugh"
        ? zhCN.events.laugh
        : next === "smile"
          ? zhCN.events.smile
          : zhCN.events.ready,
    );
  }, []);

  const resetExperienceRuntime = () => {
    particlesRef.current.splice(0);
    ripplesRef.current = createRipplePool();
    burstRingsRef.current = createBurstRingPool();
    impactMatricesRef.current = createImpactMatrixPool();
    resetCollisionEvidencePool(collisionEvidenceRef.current);
    headRef.current.visible = false;
    baselineRef.current = { smile: 0, jaw: 0, cheek: 0, samples: 0 };
    smoothedRef.current = { smile: 0, jaw: 0, cheek: 0 };
    trackerRef.current = createExpressionTracker();
    smileResumeAtRef.current = 0;
    lastLaughRef.current = -Infinity;
    pendingLaughTriggerRef.current = false;
    laughEmissionRef.current = false;
    nextLaughFireworkAtRef.current = 0;
    laughIntensityRef.current = 0;
    rainSuppressedForLaughRef.current = false;
    rainIntensityRef.current = 0;
    glyphIndexRef.current = 0;
    lastDetectionRef.current = 0;
    lastFrameRef.current = 0;
    collisionFlashRef.current = 0;
    expressionDiagnosticsRef.current = {
      rawSmile: 0,
      smileLeft: 0,
      smileRight: 0,
      rawJaw: 0,
      cheekSquint: 0,
      smile: 0,
      jaw: 0,
      laughSmile: 0,
      laughIntensity: 0,
      candidateState: "neutral",
      candidateDurationMs: 0,
      faceTracked: false,
      thresholds: getExpressionThresholds(baselineRef.current),
    };
    resetCollisionSession();
    disableCollisionDebug();
    updateExpression("neutral");
    setTelemetry(EMPTY_TELEMETRY);
  };

  const deactivateCurrentCamera = (mode: "idle" | "demo") => {
    const stream = streamRef.current;
    const landmarker = landmarkerRef.current;
    streamRef.current = null;
    landmarkerRef.current = null;
    deactivateCameraRuntime({
      gate: cameraStartupGateRef.current,
      mode,
      stream,
      landmarker,
      video: videoRef.current,
      resetRuntime: resetExperienceRuntime,
    });
  };

  const fadeRainForLaugh = useCallback(() => {
    const now = performance.now();
    for (const particle of particlesRef.current) {
      if (
        particle.kind === "rain" ||
        particle.kind === "star" ||
        particle.kind === "letter" ||
        particle.kind === "drift"
      ) {
        particle.fadeStartedAt = now;
        particle.fadeDurationMs = RAIN_FADE_MS;
      }
    }
  }, []);

  const spawnFirework = useCallback(
    (
      amount = 78,
      fastPreview = false,
      debugTarget?: FireworkDebugTarget,
      laughIntensity = 0,
    ) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const particles = particlesRef.current;
      const satelliteAmount = Math.max(16, Math.round(amount * 0.34));
      const includeSatellite = debugTarget === undefined;
      const reservedParticles =
        Math.round(amount * FIREWORK_MAIN_DENSITY) +
        (includeSatellite ? satelliteAmount : 0) +
        (includeSatellite ? 2 : 1);
      if (
        particles.length >=
        PARTICLE_BUDGET[quality] - reservedParticles
      ) {
        return;
      }

      const burstId = nextBurstIdRef.current;
      nextBurstIdRef.current += 1;
      collisionAuditRef.current.currentBurstId = burstId;
      collisionAuditRef.current.currentBurstCollisions = 0;

      const head = headRef.current;
      const sequence = [
        { x: -0.5, y: -0.3, hue: 188 },
        { x: 0.46, y: -0.16, hue: 46 },
        { x: -0.08, y: 0.08, hue: 292 },
        { x: 0.56, y: 0.18, hue: 16 },
        { x: -0.42, y: 0.22, hue: 164 },
        { x: 0.14, y: -0.42, hue: 216 },
      ];
      const cue = sequence[fireworkSequenceRef.current % sequence.length];
      const peripheralSequence = [
        { x: 0.14, y: 0.24 },
        { x: 0.84, y: 0.3 },
        { x: 0.17, y: 0.7 },
        { x: 0.82, y: 0.67 },
        { x: 0.28, y: 0.16 },
        { x: 0.73, y: 0.78 },
      ];
      const peripheralCue =
        peripheralSequence[
          fireworkSequenceRef.current % peripheralSequence.length
        ];
      fireworkSequenceRef.current += 1;

      const centerX = head.visible ? head.cx : canvas.width * 0.5;
      const centerY = head.visible ? head.cy : canvas.height * 0.47;
      const faceRadiusX = head.visible ? head.rx : canvas.width * 0.14;
      const faceRadiusY = head.visible ? head.ry : canvas.height * 0.22;
      const x = debugTarget
        ? clamp(debugTarget.x, 0, canvas.width)
        : clamp(
            centerX + cue.x * faceRadiusX,
            canvas.width * 0.12,
            canvas.width * 0.88,
          );
      const targetY = debugTarget
        ? clamp(debugTarget.y, 0, canvas.height)
        : clamp(
            centerY + cue.y * faceRadiusY,
            canvas.height * 0.16,
            canvas.height * 0.68,
          );
      const baseBurstRadius = clamp(
        Math.max(faceRadiusX * 1.72, faceRadiusY * 1.22),
        canvas.width * 0.15,
        canvas.width * 0.27,
      );
      const burstRadius = clamp(
        baseBurstRadius * (1 + clamp(laughIntensity, 0, 1) * 0.38),
        baseBurstRadius,
        canvas.width * 0.37,
      );
      particles.push({
        particleId: nextParticleIdRef.current,
        burstId,
        kind: "rocket",
        x,
        y: fastPreview ? targetY + 8 : canvas.height + 24,
        vx: (Math.random() - 0.5) * 0.9,
        vy: -(11.4 + Math.random() * 2.5),
        size: 2.4,
        life: 110,
        maxLife: 110,
        hue: cue.hue + (Math.random() - 0.5) * 10,
        gravity: -0.008,
        drag: 0.998,
        bounces: 0,
        targetY,
        burstSize: amount,
        burstRadius,
        burstRateVariation: 0.985 + Math.random() * 0.03,
        burstRole: "main",
        collidesWithHead: debugTarget
          ? debugTarget.collisionEnabled
          : true,
      });
      nextParticleIdRef.current += 1;
      if (includeSatellite) {
        const satelliteTargetY = canvas.height * peripheralCue.y;
        particles.push({
          particleId: nextParticleIdRef.current,
          burstId,
          kind: "rocket",
          x: canvas.width * peripheralCue.x,
          y: fastPreview ? satelliteTargetY + 8 : canvas.height + 24,
          vx: (Math.random() - 0.5) * 0.7,
          vy: -(10.6 + Math.random() * 2.2),
          size: 1.8,
          life: 104,
          maxLife: 104,
          hue: cue.hue + 42 + (Math.random() - 0.5) * 18,
          gravity: -0.006,
          drag: 0.998,
          bounces: 0,
          targetY: satelliteTargetY,
          burstSize: satelliteAmount,
          burstRadius: canvas.width * (0.065 + Math.random() * 0.025),
          burstRateVariation: 0.985 + Math.random() * 0.03,
          burstRole: "satellite",
          collidesWithHead: false,
          delay: fastPreview ? 8 : 12 + Math.random() * 8,
        });
        nextParticleIdRef.current += 1;
      }
      if (!debugTarget || debugTarget.collisionEnabled) {
        collisionFlashRef.current = 1;
      }
    },
    [quality],
  );

  const triggerDebugFirework = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!debugModeRef.current) return;
      const canvas = event.currentTarget;
      const bounds = canvas.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;

      const x = (event.clientX - bounds.left) * (canvas.width / bounds.width);
      const y = (event.clientY - bounds.top) * (canvas.height / bounds.height);
      spawnFirework(78, true, {
        x,
        y,
        collisionEnabled: debugCollisionRef.current,
      });
    },
    [spawnFirework],
  );

  const enterLaugh = useCallback(() => {
    const now = performance.now();
    fadeRainForLaugh();
    updateExpression("laugh");
    lastLaughRef.current = now;
    fireworkSequenceRef.current = 0;
    pendingLaughTriggerRef.current = true;
    laughEmissionRef.current = true;
    nextLaughFireworkAtRef.current = now;
  }, [fadeRainForLaugh, updateExpression]);

  const spawnRain = useCallback((
    count: number,
    accelerated = false,
    smileIntensity = 0.5,
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const particles = particlesRef.current;
    for (let index = 0; index < count; index += 1) {
      if (particles.length >= PARTICLE_BUDGET[quality]) break;
      const groundY = canvas.height * (0.82 + Math.random() * 0.13);
      const speedMultiplier = 0.78 + smileIntensity * 1.12;
      const velocityY = (5.8 + Math.random() * 4.1) * speedMultiplier;
      const roll = Math.random();
      const kind: FallingKind =
        roll < 0.62 ? "rain" : roll < 0.82 ? "star" : "letter";
      const glyph =
        kind === "letter"
          ? GLYPHS[glyphIndexRef.current++ % GLYPHS.length]
          : undefined;
      particles.push({
        kind,
        x: Math.random() * canvas.width,
        y:
          accelerated && index === 0
            ? groundY - velocityY * 2.4
            : -24 - Math.random() * 100,
        vx: -0.62 + Math.random() * 0.44,
        vy: velocityY,
        size:
          kind === "rain"
            ? 1 + Math.random() * 1.25
            : EFFECT_DECORATION_SIZE_MIN +
              Math.random() * EFFECT_DECORATION_SIZE_RANGE,
        life: canvas.height / 5.5 + 56,
        maxLife: canvas.height / 5.5 + 56,
        hue:
          kind === "letter"
            ? 214 + Math.random() * 22
            : 188 + Math.random() * 24,
        gravity: kind === "rain" ? 0.018 : 0.012,
        drag: kind === "rain" ? 1 : 0.998,
        bounces: 0,
        groundY,
        glyph,
        rotation: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 0.035,
        trailLength:
          kind === "rain"
            ? 5.2 + smileIntensity * 2.6 + Math.random() * 6.2
            : undefined,
      });
    }
  }, [quality]);

  const handleTrackingLost = useCallback(
    (message: string) => {
      const now = performance.now();
      headRef.current.visible = false;
      trackerRef.current = createExpressionTracker();
      pendingLaughTriggerRef.current = false;
      laughEmissionRef.current = false;
      nextLaughFireworkAtRef.current = 0;
      laughIntensityRef.current = 0;
      rainSuppressedForLaughRef.current = false;
      rainIntensityRef.current = 0;
      smileResumeAtRef.current = Math.max(
        smileResumeAtRef.current,
        now + EXPRESSION_CONFIG.smileResumeDelayMs,
      );
      smoothedRef.current = {
        smile: baselineRef.current.smile,
        jaw: baselineRef.current.jaw,
        cheek: baselineRef.current.cheek,
      };
      expressionDiagnosticsRef.current = {
        ...expressionDiagnosticsRef.current,
        rawSmile: 0,
        smileLeft: 0,
        smileRight: 0,
        rawJaw: 0,
        cheekSquint: 0,
        smile: 0,
        jaw: 0,
        laughSmile: 0,
        laughIntensity: 0,
        candidateState: "neutral",
        candidateDurationMs: 0,
        faceTracked: false,
      };
      updateExpression("neutral");
      setEventMessage(message);
    },
    [updateExpression],
  );

  const analyzeFace = useCallback(
    (
      result: FaceLandmarkerResult,
      width: number,
      height: number,
      videoWidth: number,
      videoHeight: number,
    ) => {
      const landmarks = result.faceLandmarks[0];
      if (!landmarks) {
        advanceNeutralCalibration(baselineRef.current, null, {
          hasFace: false,
          requiredSamples: EXPRESSION_CONFIG.calibrationSamples,
        });
        handleTrackingLost(zhCN.events.noFace);
        return;
      }

      const smileLeft = blendshapeScore(result, ["mouthSmileLeft"]);
      const smileRight = blendshapeScore(result, ["mouthSmileRight"]);
      const smileRaw = combineSmileSides(smileLeft, smileRight);
      const jawRaw = blendshapeScore(result, ["jawOpen"]);
      const cheekRaw = blendshapeScore(result, [
        "cheekSquintLeft",
        "cheekSquintRight",
      ]);
      smoothedRef.current.smile =
        smoothedRef.current.smile * 0.72 + smileRaw * 0.28;
      smoothedRef.current.jaw =
        smoothedRef.current.jaw * 0.72 + jawRaw * 0.28;
      smoothedRef.current.cheek =
        smoothedRef.current.cheek * 0.72 + cheekRaw * 0.28;

      const baseline = baselineRef.current;
      const calibration = advanceNeutralCalibration(
        baseline,
        { smile: smileRaw, jaw: jawRaw, cheek: cheekRaw },
        {
          hasFace: true,
          requiredSamples: EXPRESSION_CONFIG.calibrationSamples,
        },
      );
      if (calibration.accepted) {
        setEventMessage(
          neutralCalibrationPrompt(calibration, {
            calibrating: (progress: number) =>
              `${zhCN.events.calibratingStill} · ${progress}%`,
            ready: zhCN.events.ready,
          }),
        );
      }

      const smile = smoothedRef.current.smile;
      const jaw = smoothedRef.current.jaw;
      const cheek = smoothedRef.current.cheek;
      const laughSmile = combineLaughSmile(smile, cheek, baseline.cheek);
      const laughSmileRaw = combineLaughSmile(
        smileRaw,
        cheekRaw,
        baseline.cheek,
      );
      const laughSmileEvidence = Math.max(laughSmile, laughSmileRaw);
      const laughJawEvidence = Math.max(jaw, jawRaw);
      const canClassify = calibration.canClassify;
      const laughPreempt =
        canClassify &&
        isLaughPreemptCandidate(laughSmileRaw, jawRaw, baseline);
      const laughIntensity = normalizeLaughIntensity(
        laughSmileEvidence,
        laughJawEvidence,
        baseline,
      );
      const now = performance.now();
      const decision = advanceExpressionState({
        current: expressionRef.current,
        smile,
        laughSmile: laughSmileEvidence,
        jaw: laughJawEvidence,
        baseline,
        tracker: trackerRef.current,
        canClassify,
        now,
        smileResumeAt: smileResumeAtRef.current,
        laughCooldownUntil:
          lastLaughRef.current + EXPRESSION_CONFIG.laughCooldownMs,
        laughPreempt,
      });
      trackerRef.current = decision.tracker;
      laughEmissionRef.current =
        canClassify && laughPreempt && decision.gates.laughContinuous;
      laughIntensityRef.current = laughEmissionRef.current
        ? laughIntensity
        : 0;
      const suppressRain =
        canClassify &&
        (jawRaw > decision.thresholds.smileJawEnterMax ||
          jaw > decision.thresholds.smileJawExitMax ||
          laughPreempt ||
          decision.gates.laughEvidence ||
          decision.gates.laughContinuous);
      if (suppressRain && !rainSuppressedForLaughRef.current) {
        fadeRainForLaugh();
      }
      rainSuppressedForLaughRef.current = suppressRain;

      if (decision.enteredLaugh) {
        enterLaugh();
      } else if (decision.exitedLaugh) {
        smileResumeAtRef.current =
          now + EXPRESSION_CONFIG.smileResumeDelayMs;
        updateExpression("neutral");
      } else if (decision.next !== expressionRef.current) {
        updateExpression(decision.next as Expression);
      }

      const collider = colliderFromLandmarks(
        landmarks,
        width,
        height,
        videoWidth,
        videoHeight,
        headRef.current,
      );
      if (collider) headRef.current = collider;
      expressionDiagnosticsRef.current = {
        rawSmile: smileRaw,
        smileLeft,
        smileRight,
        rawJaw: jawRaw,
        cheekSquint: cheekRaw,
        smile,
        jaw,
        laughSmile,
        laughIntensity,
        candidateState: decision.candidate as Expression,
        candidateDurationMs: decision.candidateDurationMs,
        faceTracked: true,
        thresholds: decision.thresholds,
      };
    },
    [enterLaugh, fadeRainForLaugh, handleTrackingLost, updateExpression],
  );

  const drawFrame = useCallback(
    (now: number) => {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas) return;
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) return;

      const bounds = canvas.getBoundingClientRect();
      const dpr = Math.min(
        window.devicePixelRatio || 1,
        quality === "lite" ? 1.1 : quality === "high" ? 1.6 : 1.35,
      );
      const nextWidth = Math.max(1, Math.round(bounds.width * dpr));
      const nextHeight = Math.max(1, Math.round(bounds.height * dpr));
      if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
        canvas.width = nextWidth;
        canvas.height = nextHeight;
        headRef.current.visible = false;
        particlesRef.current.splice(0);
        ripplesRef.current = createRipplePool();
        burstRingsRef.current = createBurstRingPool();
        impactMatricesRef.current = createImpactMatrixPool();
        resetCollisionEvidencePool(collisionEvidenceRef.current);
      }

      if (lastFrameRef.current === 0) lastFrameRef.current = now;
      const dt = clamp((now - lastFrameRef.current) / 16.67, 0.45, 2.2);
      const elapsed = now - lastFrameRef.current;
      lastFrameRef.current = now;
      frameStatsRef.current.elapsed += elapsed;
      frameStatsRef.current.frames += 1;
      if (frameStatsRef.current.elapsed > 600) {
        frameStatsRef.current.fps = Math.round(
          (frameStatsRef.current.frames * 1000) /
            frameStatsRef.current.elapsed,
        );
        frameStatsRef.current.elapsed = 0;
        frameStatsRef.current.frames = 0;
      }

      context.clearRect(0, 0, canvas.width, canvas.height);

      const adaptiveLite =
        quality === "lite" ||
        (quality === "auto" && frameStatsRef.current.fps < 38);
      detectionIntervalRef.current =
        expressionRef.current === "laugh" || frameStatsRef.current.fps < 34
          ? LAUGH_DETECTION_INTERVAL_MS
          : DETECTION_INTERVAL_MS;

      if (
        engineState === "live" &&
        video &&
        landmarkerRef.current &&
        video.readyState >= 2 &&
        now - lastDetectionRef.current >= detectionIntervalRef.current
      ) {
        lastDetectionRef.current = now;
        try {
          const result = landmarkerRef.current.detectForVideo(video, now);
          analyzeFace(
            result,
            canvas.width,
            canvas.height,
            video.videoWidth,
            video.videoHeight,
          );
        } catch {
          handleTrackingLost(zhCN.events.modelPaused);
        }
      }

      if (
        expressionRef.current === "smile" &&
        !rainSuppressedForLaughRef.current
      ) {
        const smileIntensity = normalizeSmileIntensity(
          smoothedRef.current.smile,
          baselineRef.current,
        );
        rainIntensityRef.current = smileIntensity;
        const rainCount = adaptiveLite
          ? 1 + Math.floor(smileIntensity * 2.999)
          : 1 + Math.floor(smileIntensity * 5.999);
        spawnRain(rainCount, engineState === "demo", smileIntensity);
      } else {
        rainIntensityRef.current = 0;
      }
      if (
        !debugModeRef.current &&
        expressionRef.current === "laugh" &&
        laughEmissionRef.current &&
        (pendingLaughTriggerRef.current ||
          now >= nextLaughFireworkAtRef.current)
      ) {
        pendingLaughTriggerRef.current = false;
        spawnFirework(
          adaptiveLite ? 54 : 78,
          engineState === "demo",
          undefined,
          laughIntensityRef.current,
        );
        nextLaughFireworkAtRef.current =
          now +
          (adaptiveLite
            ? FIREWORK_SUSTAIN_INTERVAL_LITE_MS
            : FIREWORK_SUSTAIN_INTERVAL_MS);
      }

      const head = headRef.current;
      const collisionEnabled =
        !debugModeRef.current || debugCollisionRef.current;
      const particles = particlesRef.current;
      const originalLength = particles.length;
      const particleLimit = PARTICLE_BUDGET[quality];
      const surfaceDrift: Particle[] = [];
      const rocketsToExplode: Particle[] = [];
      const miniFireworkSeeds: MiniFireworkSeed[] = [];
      let latestCollisionEvent: FireworkCollisionEvent | null = null;
      const captureCollisionEvent = (event: FireworkCollisionEvent) => {
        latestCollisionEvent = event;
        if (debugModeRef.current) recordCollisionEvidence(event);
      };
      let writeIndex = 0;
      let collisions = 0;
      let rainParticleCount = 0;
      let fireworkParticleCount = 0;
      context.globalCompositeOperation = "lighter";
      context.shadowBlur = 0;
      for (let index = 0; index < originalLength; index += 1) {
        const particle = particles[index];
        if ((particle.delay ?? 0) > 0) {
          particle.delay = Math.max(0, (particle.delay ?? 0) - dt);
          particles[writeIndex] = particle;
          writeIndex += 1;
          if (particle.kind === "rocket") fireworkParticleCount += 1;
          continue;
        }
        particle.previousX = particle.x;
        particle.previousY = particle.y;
        particle.collisionCooldown = Math.max(
          0,
          (particle.collisionCooldown ?? 0) - dt,
        );
        if (particle.kind === "firework") {
          const progress = 1 - clamp(particle.life / particle.maxLife, 0, 1);
          const trail = particle.trail ?? (particle.trail = []);
          const lastTrailPoint = trail[trail.length - 1];
          if (
            !lastTrailPoint ||
            Math.hypot(
              particle.x - lastTrailPoint.x,
              particle.y - lastTrailPoint.y,
            ) > 0.35
          ) {
            trail.push({ x: particle.x, y: particle.y });
          }
          const lateTrailShrink = smoothstep(0.68, 0.96, progress);
          const visibleTrailCapacity = Math.max(
            2,
            Math.round(
              (particle.trailCapacity ?? 8) * (1 - lateTrailShrink * 0.7),
            ),
          );
          if (trail.length > visibleTrailCapacity) {
            trail.splice(0, trail.length - visibleTrailCapacity);
          }

          if (particle.curve) {
            const rotation = particle.curve * dt;
            const cosine = Math.cos(rotation);
            const sine = Math.sin(rotation);
            const nextVx = particle.vx * cosine - particle.vy * sine;
            particle.vy = particle.vx * sine + particle.vy * cosine;
            particle.vx = nextVx;
          }

          const dragTransition = smoothstep(0.08, 0.44, progress);
          const frameDrag =
            particle.drag +
            ((particle.lateDrag ?? particle.drag) - particle.drag) *
              dragTransition;
          const dragFactor = Math.pow(frameDrag, dt);
          const turbulenceStrength =
            (particle.turbulence ?? 0) *
            smoothstep(0.12, 0.48, progress) *
            (1 - smoothstep(0.72, 1, progress));
          const turbulencePhase =
            (particle.flickerPhase ?? 0) + progress * Math.PI * 7;
          particle.vx =
            particle.vx * dragFactor +
            Math.sin(turbulencePhase) * turbulenceStrength * dt;
          const gravityInfluence = smoothstep(
            particle.gravityDelay ?? 0.32,
            (particle.gravityDelay ?? 0.32) + (particle.gravityRamp ?? 0.24),
            progress,
          );
          particle.vy =
            particle.vy * dragFactor +
            particle.gravity * gravityInfluence * dt +
            Math.cos(turbulencePhase * 0.83) * turbulenceStrength * 0.55 * dt;
        } else {
          particle.vx *= particle.drag;
          particle.vy = particle.vy * particle.drag + particle.gravity * dt;
        }
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.life -= dt;
        particle.rotation =
          (particle.rotation ?? 0) + (particle.spin ?? 0) * dt;

        if (
          (particle.kind === "rain" ||
            particle.kind === "star" ||
            particle.kind === "letter") &&
          particle.y >= (particle.groundY ?? canvas.height * 0.9)
        ) {
          if (
            expressionRef.current === "smile" &&
            !rainSuppressedForLaughRef.current &&
            Math.random() < (adaptiveLite ? 0.28 : 0.44)
          ) {
            activateRipple(
              ripplesRef.current,
              particle.x,
              particle.groundY ?? particle.y,
              canvas.width,
            );
          }
          if (
            particle.kind === "rain" &&
            expressionRef.current === "smile" &&
            !rainSuppressedForLaughRef.current &&
            Math.random() < (adaptiveLite ? 0.18 : 0.32)
          ) {
            const smileIntensity = normalizeSmileIntensity(
              smoothedRef.current.smile,
              baselineRef.current,
            );
            activateImpactMatrix(
              impactMatricesRef.current,
              particle.x,
              particle.groundY ?? particle.y,
              canvas.width,
              smileIntensity,
            );
          }
          const keepSurfaceTrace =
            particle.kind === "rain" ? Math.random() < 0.42 : true;
          if (
            expressionRef.current === "smile" &&
            !rainSuppressedForLaughRef.current &&
            keepSurfaceTrace &&
            originalLength + surfaceDrift.length < particleLimit
          ) {
            surfaceDrift.push({
              kind: "drift",
              sourceKind: particle.kind,
              glyph: particle.glyph,
              x: particle.x,
              y: particle.groundY ?? particle.y,
              vx:
                (Math.random() > 0.5 ? 1 : -1) *
                (0.7 + Math.random() * 1.6),
              vy: -(0.35 + Math.random() * 1.05),
              size: particle.kind === "rain" ? 1.1 : particle.size * 0.9,
              life: 78 + Math.random() * 56,
              maxLife: 134,
              hue: particle.hue,
              gravity: 0.016,
              drag: 0.993,
              bounces: 0,
              rotation: particle.rotation,
              spin: (Math.random() - 0.5) * 0.05,
            });
          }
          continue;
        }

        if (
          particle.kind === "rocket" &&
          particle.y <= (particle.targetY ?? canvas.height * 0.28)
        ) {
          rocketsToExplode.push(particle);
          if (particle.collidesWithHead !== false) {
            collisionFlashRef.current = 1;
          }
          continue;
        }

        latestCollisionEvent = null;
        if (
          collisionEnabled &&
          collideParticle(particle, head, captureCollisionEvent, now)
        ) {
          collisions += 1;
          const collisionEvent = latestCollisionEvent;
          if (
            particle.collisionResponse === "miniBurst" &&
            collisionEvent?.particleId === particle.particleId &&
            miniFireworkSeeds.length < MAX_MINI_FIREWORK_BURSTS_PER_FRAME
          ) {
            miniFireworkSeeds.push({
              ...collisionEvent,
              hue: particle.hue,
            });
            particle.life = 0;
          }
          if (
            debugModeRef.current &&
            showCollisionEvidenceRef.current &&
            collisionEvent?.particleId === particle.particleId
          ) {
            activateCollisionEvidenceFlash(
              collisionEvidenceRef.current,
              collisionEvent,
            );
          }
        }

        const rainFade =
          particle.fadeStartedAt === undefined
            ? 1
            : clamp(
                1 -
                  (now - particle.fadeStartedAt) /
                    (particle.fadeDurationMs ?? RAIN_FADE_MS),
                0,
                1,
              );
        const expired =
          particle.life <= 0 ||
          rainFade <= 0 ||
          particle.y > canvas.height + 80 ||
          particle.x < -100 ||
          particle.x > canvas.width + 100;
        if (expired) {
          continue;
        }

        const alpha =
          clamp(particle.life / particle.maxLife, 0, 1) * rainFade;
        context.beginPath();
        if (particle.kind === "rain") {
          rainParticleCount += 1;
          const trailScale = particle.trailLength ?? 5.4;
          const trailX = particle.x - particle.vx * trailScale;
          const trailY = particle.y - particle.vy * trailScale;
          context.strokeStyle = `hsla(${particle.hue}, 100%, 84%, ${alpha * 0.34})`;
          context.lineWidth = particle.size * 4.6 * dpr;
          context.moveTo(particle.x, particle.y);
          context.lineTo(trailX, trailY);
          context.stroke();
          context.beginPath();
          context.strokeStyle = `hsla(${particle.hue}, 24%, 100%, ${alpha})`;
          context.lineWidth = Math.max(0.82, particle.size * 0.92) * dpr;
          context.moveTo(particle.x, particle.y);
          context.lineTo(trailX, trailY);
          context.stroke();
          context.beginPath();
          context.fillStyle = `hsla(${particle.hue}, 100%, 84%, ${alpha * 0.3})`;
          context.arc(
            particle.x,
            particle.y,
            particle.size * 3.2 * dpr,
            0,
            Math.PI * 2,
          );
          context.fill();
          context.beginPath();
          context.fillStyle = `hsla(${particle.hue}, 18%, 100%, ${alpha})`;
          context.arc(
            particle.x,
            particle.y,
            Math.max(0.8, particle.size) * dpr,
            0,
            Math.PI * 2,
          );
          context.fill();
        } else if (particle.kind === "star") {
          rainParticleCount += 1;
          context.fillStyle = `hsla(${particle.hue}, 100%, 78%, ${alpha * 0.2})`;
          drawStar(
            context,
            particle.x,
            particle.y,
            particle.size * 1.9 * dpr,
            particle.rotation ?? 0,
          );
          context.fill();
          context.beginPath();
          context.fillStyle = `hsla(${particle.hue}, 28%, 98%, ${alpha * 0.96})`;
          drawStar(
            context,
            particle.x,
            particle.y,
            particle.size * dpr,
            particle.rotation ?? 0,
          );
          context.fill();
        } else if (particle.kind === "letter") {
          rainParticleCount += 1;
          context.save();
          context.translate(particle.x, particle.y);
          context.rotate(particle.rotation ?? 0);
          context.font = `700 ${Math.round(particle.size * 2.1 * dpr)}px ui-sans-serif, system-ui`;
          context.textAlign = "center";
          context.textBaseline = "middle";
          context.fillStyle = `hsla(${particle.hue}, 100%, 78%, ${alpha * 0.22})`;
          context.fillText(particle.glyph ?? "J", 0, 0);
          context.fillStyle = `hsla(${particle.hue}, 22%, 98%, ${alpha * 0.96})`;
          context.fillText(particle.glyph ?? "J", 0, 0);
          context.restore();
        } else if (particle.kind === "drift") {
          rainParticleCount += 1;
          const surfaceAlpha = alpha * Math.min(1, (particle.maxLife - particle.life + 8) / 18);
          if (particle.sourceKind === "star") {
            context.fillStyle = `hsla(${particle.hue}, 100%, 80%, ${surfaceAlpha * 0.2})`;
            drawStar(
              context,
              particle.x,
              particle.y,
              particle.size * 1.8 * dpr,
              particle.rotation ?? 0,
            );
            context.fill();
            context.beginPath();
            context.fillStyle = `hsla(${particle.hue}, 26%, 98%, ${surfaceAlpha * 0.92})`;
            drawStar(
              context,
              particle.x,
              particle.y,
              particle.size * dpr,
              particle.rotation ?? 0,
            );
            context.fill();
          } else if (particle.sourceKind === "letter") {
            context.save();
            context.translate(particle.x, particle.y);
            context.rotate(particle.rotation ?? 0);
            context.font = `700 ${Math.round(particle.size * 2 * dpr)}px ui-sans-serif, system-ui`;
            context.textAlign = "center";
            context.textBaseline = "middle";
            context.fillStyle = `hsla(${particle.hue}, 100%, 82%, ${surfaceAlpha * 0.2})`;
            context.fillText(particle.glyph ?? "J", 0, 0);
            context.fillStyle = `hsla(${particle.hue}, 24%, 98%, ${surfaceAlpha * 0.9})`;
            context.fillText(particle.glyph ?? "J", 0, 0);
            context.restore();
          } else {
            context.fillStyle = `hsla(${particle.hue}, 100%, 82%, ${surfaceAlpha * 0.65})`;
            context.ellipse(
              particle.x,
              particle.y,
              particle.size * 2.2 * dpr,
              particle.size * 0.72 * dpr,
              particle.rotation ?? 0,
              0,
              Math.PI * 2,
            );
            context.fill();
          }
        } else if (particle.kind === "rocket") {
          fireworkParticleCount += 1;
          context.strokeStyle = `hsla(${particle.hue}, 100%, 82%, ${alpha * 0.34})`;
          context.lineWidth = 5.5 * dpr;
          context.moveTo(particle.x, particle.y + 28 * dpr);
          context.lineTo(particle.x, particle.y);
          context.stroke();
          context.beginPath();
          context.strokeStyle = `hsla(${particle.hue}, 100%, 92%, ${alpha * 0.92})`;
          context.lineWidth = 1.5 * dpr;
          context.moveTo(particle.x, particle.y + 24 * dpr);
          context.lineTo(particle.x, particle.y);
          context.stroke();
        } else if (particle.kind === "firework") {
          fireworkParticleCount += 1;
          const progress = 1 - clamp(particle.life / particle.maxLife, 0, 1);
          const layer = particle.fireworkLayer ?? "primary";
          const fadeStart = particle.fadeStart ?? 0.56;
          const ignition = smoothstep(0, 0.055, progress);
          const fade = 1 - smoothstep(fadeStart, 1, progress);
          const flicker =
            layer === "primary"
              ? 1
              : 0.78 +
                Math.sin((particle.flickerPhase ?? 0) + progress * Math.PI * 23) *
                  0.18;
          const fireworkAlpha = clamp(ignition * fade * flicker, 0, 1);
          const saturation = particle.saturation ?? 88;
          const baseBrightness = particle.brightness ?? 94;
          const brightness = clamp(
            baseBrightness +
              (1 - smoothstep(0.02, 0.16, progress)) * 8 +
              (1 - smoothstep(0.42, 0.72, progress)) * 3 -
              smoothstep(0.66, 1, progress) * 18,
            48,
            88,
          );
          const starProgress = clamp(
            (progress - (particle.starMorphStart ?? 0.62)) / 0.24,
            0,
            1,
          );
          drawFireworkTrail(
            context,
            particle,
            dpr,
            fireworkAlpha,
            brightness,
          );

          const fireworkRenderSize = particle.fireworkDecoration
            ? Math.min(1.05, particle.size * 0.18)
            : particle.size;
          context.beginPath();
          context.fillStyle = `hsla(${particle.hue}, ${saturation}%, ${Math.min(84, brightness + 8)}%, ${fireworkAlpha * (layer === "primary" ? 0.23 : 0.15)})`;
          context.arc(
            particle.x,
            particle.y,
            fireworkRenderSize * dpr * (layer === "primary" ? 2.8 : 2.15),
            0,
            Math.PI * 2,
          );
          context.fill();

          context.beginPath();
          if (particle.fireworkDecoration && starProgress > 0) {
            const decorationReveal = smoothstep(0, 0.18, starProgress);
            if (particle.fireworkDecoration === "letter" && particle.glyph) {
              context.save();
              context.translate(particle.x, particle.y);
              context.rotate(particle.rotation ?? 0);
              context.font = `700 ${Math.round(particle.size * 2.1 * dpr)}px ui-sans-serif, system-ui`;
              context.textAlign = "center";
              context.textBaseline = "middle";
              context.fillStyle = `hsla(${particle.hue}, ${saturation}%, ${brightness}%, ${fireworkAlpha * decorationReveal * 0.28})`;
              context.fillText(particle.glyph, 0, 0);
              context.fillStyle = `hsla(${particle.hue}, ${Math.min(62, saturation)}%, 99%, ${fireworkAlpha * decorationReveal * 0.96})`;
              context.fillText(particle.glyph, 0, 0);
              context.restore();
            } else {
              context.fillStyle = `hsla(${particle.hue}, ${saturation}%, ${brightness}%, ${fireworkAlpha * decorationReveal * 0.24})`;
              drawStar(
                context,
                particle.x,
                particle.y,
                particle.size * 1.9 * dpr,
                particle.rotation ?? 0,
              );
              context.fill();
              context.beginPath();
              context.fillStyle = `hsla(${particle.hue}, ${Math.min(58, saturation)}%, 99%, ${fireworkAlpha * decorationReveal * 0.96})`;
              drawStar(
                context,
                particle.x,
                particle.y,
                particle.size * dpr,
                particle.rotation ?? 0,
              );
            }
          } else {
            context.fillStyle = `hsla(${particle.hue}, ${saturation}%, ${brightness}%, ${fireworkAlpha * (layer === "primary" ? 0.9 : 0.72)})`;
            context.arc(
              particle.x,
              particle.y,
              particle.size * dpr * (layer === "primary" ? 1.05 : 0.82),
              0,
              Math.PI * 2,
            );
            context.fill();
            context.beginPath();
            context.fillStyle = `hsla(${particle.hue}, ${Math.min(52, saturation)}%, 99%, ${fireworkAlpha * 0.52})`;
            context.arc(
              particle.x,
              particle.y,
              particle.size * dpr * (layer === "primary" ? 0.34 : 0.26),
              0,
              Math.PI * 2,
            );
          }
          context.fill();
        }
        particles[writeIndex] = particle;
        writeIndex += 1;
      }
      particles.length = writeIndex;
      if (surfaceDrift.length) {
        particles.push(
          ...surfaceDrift.slice(0, Math.max(0, particleLimit - particles.length)),
        );
      }
      for (const rocket of rocketsToExplode) {
        explodeRocket(
          rocket,
          particles,
          burstRingsRef.current,
          particleLimit,
          canvas.width,
        );
      }
      for (const seed of miniFireworkSeeds) {
        const appended = appendMiniFireworkBurst(
          seed,
          particles,
          particleLimit,
          nextParticleIdRef.current,
        );
        nextParticleIdRef.current += appended;
        if (appended > 0) {
          activateBurstRing(
            burstRingsRef.current,
            seed.contactX,
            seed.contactY,
            canvas.width * 0.052,
            seed.hue,
          );
        }
      }

      let activeRipples = 0;
      context.globalCompositeOperation = "lighter";
      for (const ripple of ripplesRef.current) {
        if (!ripple.active) continue;
        ripple.age += Math.min(elapsed, 50);
        if (ripple.age >= ripple.duration) {
          ripple.active = false;
          continue;
        }
        activeRipples += 1;
        const progress = clamp(ripple.age / ripple.duration, 0, 1);
        for (let ring = 0; ring < ripple.rings; ring += 1) {
          const ringProgress = clamp(progress - ring * 0.07, 0, 1);
          const eased = 1 - Math.pow(1 - ringProgress, 3);
          const radius = ripple.radius * (0.35 + eased * (1.3 + ring * 0.2));
          const alpha = (1 - ringProgress) * (0.38 - ring * 0.055);
          context.beginPath();
          context.ellipse(
            ripple.x,
            ripple.y,
            radius,
            Math.max(2, radius * 0.22),
            0,
            0,
            Math.PI * 2,
          );
          context.strokeStyle = `hsla(${ripple.hue}, 90%, 76%, ${alpha})`;
          context.lineWidth = Math.max(1.6, 3.2 - ring * 0.32) * dpr;
          context.globalAlpha = 0.22;
          context.stroke();
          context.globalAlpha = 1;
          context.beginPath();
          context.ellipse(
            ripple.x,
            ripple.y,
            radius,
            Math.max(2, radius * 0.22),
            0,
            0,
            Math.PI * 2,
          );
          context.strokeStyle = `hsla(${ripple.hue}, 34%, 98%, ${alpha * 0.94})`;
          context.lineWidth = Math.max(0.72, 1.18 - ring * 0.16) * dpr;
          context.stroke();
        }
      }

      for (const matrix of impactMatricesRef.current) {
        if (!matrix.active) continue;
        matrix.age += Math.min(elapsed, 50);
        if (matrix.age >= matrix.duration) {
          matrix.active = false;
          continue;
        }
        activeRipples += 1;
        const progress = clamp(matrix.age / matrix.duration, 0, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const alpha = Math.sin(Math.PI * progress) * (1 - progress * 0.42);
        for (let ring = 0; ring < 2; ring += 1) {
          const dots = 10 + ring * 4;
          const radius =
            matrix.radius * (0.18 + eased * (0.72 + ring * 0.34));
          context.beginPath();
          for (let dot = 0; dot < dots; dot += 1) {
            const angle =
              matrix.phase + (dot / dots) * Math.PI * 2 + ring * 0.18;
            const x = matrix.x + Math.cos(angle) * radius;
            const y = matrix.y + Math.sin(angle) * radius * 0.42;
            const dotRadius = (2.8 - ring * 0.45) * dpr;
            context.moveTo(x + dotRadius, y);
            context.arc(x, y, dotRadius, 0, Math.PI * 2);
          }
          context.fillStyle = `hsla(${matrix.hue}, 100%, 78%, ${alpha * (0.26 - ring * 0.04)})`;
          context.fill();
          context.beginPath();
          for (let dot = 0; dot < dots; dot += 1) {
            const angle =
              matrix.phase + (dot / dots) * Math.PI * 2 + ring * 0.18;
            const x = matrix.x + Math.cos(angle) * radius;
            const y = matrix.y + Math.sin(angle) * radius * 0.42;
            const dotRadius = (0.82 - ring * 0.08) * dpr;
            context.moveTo(x + dotRadius, y);
            context.arc(x, y, dotRadius, 0, Math.PI * 2);
          }
          context.fillStyle = `hsla(${matrix.hue}, 20%, 100%, ${alpha * 0.96})`;
          context.fill();
        }
      }

      for (const burstRing of burstRingsRef.current) {
        if (!burstRing.active) continue;
        burstRing.age += Math.min(elapsed, 50);
        if (burstRing.age >= burstRing.duration) {
          burstRing.active = false;
          continue;
        }
        const progress = clamp(burstRing.age / burstRing.duration, 0, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const flashAlpha = 1 - smoothstep(0.16, 1, progress);
        const haloRadius = burstRing.radius * (0.045 + eased * 0.24);
        const halo = context.createRadialGradient(
          burstRing.x,
          burstRing.y,
          0,
          burstRing.x,
          burstRing.y,
          haloRadius,
        );
        halo.addColorStop(0, `hsla(48, 12%, 100%, ${flashAlpha * 0.82})`);
        halo.addColorStop(
          0.22,
          `hsla(${burstRing.hue}, 82%, 82%, ${flashAlpha * 0.34})`,
        );
        halo.addColorStop(1, `hsla(${burstRing.hue}, 90%, 70%, 0)`);
        context.beginPath();
        context.arc(burstRing.x, burstRing.y, haloRadius, 0, Math.PI * 2);
        context.fillStyle = halo;
        context.fill();
      }

      collisionFlashRef.current = Math.max(
        collisions ? 0.94 : collisionFlashRef.current * 0.92,
        0,
      );
      if (
        debugModeRef.current &&
        showCollisionEvidenceRef.current
      ) {
        context.globalCompositeOperation = "lighter";
        for (const flash of collisionEvidenceRef.current) {
          if (!flash.active) continue;
          flash.age += Math.min(elapsed, 50);
          if (flash.age >= flash.duration) {
            flash.active = false;
            continue;
          }
          const progress = clamp(flash.age / flash.duration, 0, 1);
          const alpha = Math.pow(1 - progress, 1.8);
          const radius = (2.2 + progress * 1.4) * dpr;
          context.beginPath();
          context.arc(flash.x, flash.y, radius * 1.38, 0, Math.PI * 2);
          context.fillStyle = `rgba(93, 255, 222, ${alpha * 0.18})`;
          context.fill();
          context.beginPath();
          context.arc(flash.x, flash.y, radius, 0, Math.PI * 2);
          context.fillStyle = `rgba(224, 255, 248, ${alpha * 0.88})`;
          context.fill();
        }
      }
      if (
        head.visible &&
        debugModeRef.current &&
        showHeadColliderRef.current
      ) {
        context.globalCompositeOperation = "source-over";
        context.beginPath();
        context.ellipse(
          head.cx,
          head.cy,
          head.rx,
          head.ry,
          head.rotation,
          0,
          Math.PI * 2,
        );
        context.strokeStyle = "rgba(91, 226, 203, 0.58)";
        context.lineWidth = 1.25 * dpr;
        context.setLineDash([5 * dpr, 6 * dpr]);
        context.stroke();
        context.setLineDash([]);
        const directionLength = Math.max(12 * dpr, head.rx * 0.24);
        const directionX = Math.cos(head.rotation) * directionLength;
        const directionY = Math.sin(head.rotation) * directionLength;
        context.beginPath();
        context.moveTo(head.cx - directionX, head.cy - directionY);
        context.lineTo(head.cx + directionX, head.cy + directionY);
        context.strokeStyle = "rgba(91, 226, 203, 0.5)";
        context.lineWidth = dpr;
        context.stroke();
        context.beginPath();
        context.arc(head.cx, head.cy, 2.2 * dpr, 0, Math.PI * 2);
        context.fillStyle = "rgba(218, 255, 247, 0.82)";
        context.fill();
      }
      context.globalCompositeOperation = "source-over";

      if (now - lastTelemetryRef.current >= 320) {
        lastTelemetryRef.current = now;
        const collisionAudit = collisionAuditRef.current;
        const expressionDiagnostics = expressionDiagnosticsRef.current;
        const expressionThresholds = expressionDiagnostics.thresholds;
        setTelemetry((previous) => ({
          ...previous,
          smile: expressionDiagnostics.smile,
          jaw: expressionDiagnostics.jaw,
          rawSmile: expressionDiagnostics.rawSmile,
          smileLeft: expressionDiagnostics.smileLeft,
          smileRight: expressionDiagnostics.smileRight,
          rawJaw: expressionDiagnostics.rawJaw,
          cheekSquint: expressionDiagnostics.cheekSquint,
          laughSmile: expressionDiagnostics.laughSmile,
          laughIntensity: expressionDiagnostics.laughIntensity,
          fps: frameStatsRef.current.fps,
          inferenceFps: Math.round(1000 / detectionIntervalRef.current),
          particles: particles.length,
          rainParticles: rainParticleCount,
          fireworkParticles: fireworkParticleCount,
          ripples: activeRipples,
          cooldownMs: Math.max(
            0,
            EXPRESSION_CONFIG.laughCooldownMs -
              (performance.now() - lastLaughRef.current),
          ),
          face: expressionDiagnostics.faceTracked,
          smileThreshold: expressionThresholds.smileEnter,
          smileExitThreshold: expressionThresholds.smileExit,
          laughSmileThreshold: expressionThresholds.laughSmileEnter,
          laughSmileExitThreshold: expressionThresholds.laughSmileExit,
          laughJawThreshold: expressionThresholds.laughJawEnter,
          laughJawExitThreshold: expressionThresholds.laughJawExit,
          candidateState: expressionDiagnostics.candidateState,
          stableState: expressionRef.current,
          candidateDurationMs: expressionDiagnostics.candidateDurationMs,
          rainEmission:
            expressionDiagnostics.faceTracked &&
            expressionRef.current === "smile" &&
            !rainSuppressedForLaughRef.current,
          rainIntensity: rainIntensityRef.current,
          currentBurstCollisions: collisionAudit.currentBurstCollisions,
          sessionCollisions: collisionAudit.sessionCollisions,
          lastCollisionAgeMs:
            collisionAudit.lastCollisionAt === null
              ? null
              : Math.max(0, now - collisionAudit.lastCollisionAt),
          colliderTracked: head.visible,
          collisionEnabled,
        }));
      }

      animationRef.current = requestAnimationFrame((time) =>
        drawFrameRef.current(time),
      );
    },
    [
      analyzeFace,
      engineState,
      handleTrackingLost,
      quality,
      recordCollisionEvidence,
      spawnFirework,
      spawnRain,
    ],
  );

  useEffect(() => {
    drawFrameRef.current = drawFrame;
    animationRef.current = requestAnimationFrame((time) =>
      drawFrameRef.current(time),
    );
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [drawFrame]);

  const handlePageHidden = useEffectEvent(() => {
    deactivateCurrentCamera("idle");
    setErrorMessage("");
    setEngineState("idle");
    setEventMessage(zhCN.events.waiting);
  });

  useEffect(
    () => listenForPageHidden(document, handlePageHidden),
    [],
  );

  useEffect(
    () => () => {
      cameraStartupGateRef.current.invalidate("idle");
      const stream = streamRef.current;
      const landmarker = landmarkerRef.current;
      streamRef.current = null;
      landmarkerRef.current = null;
      releaseCameraResources({
        stream,
        landmarker,
        video: videoRef.current,
      });
    },
    [],
  );

  const startCamera = async () => {
    const startupGate = cameraStartupGateRef.current;
    const startupToken = startupGate.beginCameraStart();
    const previousStream = streamRef.current;
    const previousLandmarker = landmarkerRef.current;
    streamRef.current = null;
    landmarkerRef.current = null;
    releaseCameraResources({
      stream: previousStream,
      landmarker: previousLandmarker,
      video: videoRef.current,
    });
    resetExperienceRuntime();

    if (!navigator.mediaDevices?.getUserMedia) {
      startupGate.invalidate("idle");
      setErrorMessage(zhCN.errors.unsupportedCamera);
      setEngineState("error");
      setEventMessage(zhCN.errors.unsupportedCamera);
      return;
    }

    setErrorMessage("");
    setEngineState("loading");
    setEventMessage(zhCN.events.requestingCamera);
    let stream: MediaStream | null = null;
    let createdLandmarker: FaceLandmarker | null = null;
    const releasePendingResources = () => {
      if (streamRef.current === stream) streamRef.current = null;
      if (landmarkerRef.current === createdLandmarker) {
        landmarkerRef.current = null;
      }
      releaseCameraResources({
        stream,
        landmarker: createdLandmarker,
        video: videoRef.current,
      });
    };

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30, max: 30 },
        },
      });
    } catch (error) {
      if (!startupGate.isCurrent(startupToken)) return;
      const errorName = error instanceof DOMException ? error.name : "";
      const message =
        errorName === "NotAllowedError" || errorName === "SecurityError"
          ? zhCN.errors.permissionDenied
          : errorName === "NotFoundError" ||
              errorName === "DevicesNotFoundError" ||
              errorName === "OverconstrainedError"
            ? zhCN.errors.noCamera
            : zhCN.errors.noCamera;
      startupGate.invalidate("idle");
      setErrorMessage(message);
      setEngineState("error");
      setEventMessage(message);
      return;
    }

    if (!startupGate.isCurrent(startupToken)) {
      releasePendingResources();
      return;
    }
    streamRef.current = stream;
    const video = videoRef.current;
    if (!video) {
      releasePendingResources();
      startupGate.invalidate("idle");
      setErrorMessage(zhCN.errors.missingVideo);
      setEngineState("error");
      setEventMessage(zhCN.errors.missingVideo);
      return;
    }
    video.srcObject = stream;
    try {
      await video.play();
    } catch {
      const isCurrent = startupGate.isCurrent(startupToken);
      releasePendingResources();
      if (!isCurrent) return;
      startupGate.invalidate("idle");
      setErrorMessage(zhCN.errors.noCamera);
      setEngineState("error");
      setEventMessage(zhCN.errors.noCamera);
      return;
    }

    if (!startupGate.isCurrent(startupToken)) {
      releasePendingResources();
      return;
    }
    setEventMessage(zhCN.events.loadingModel);
    try {
      const {
        FaceLandmarker: FaceLandmarkerApi,
        FilesetResolver,
      } = await import(
        "@mediapipe/tasks-vision"
      );
      if (!startupGate.isCurrent(startupToken)) {
        releasePendingResources();
        return;
      }
      const vision = await FilesetResolver.forVisionTasks(
        publicAssetPath("/wasm"),
      );
      if (!startupGate.isCurrent(startupToken)) {
        releasePendingResources();
        return;
      }
      try {
        createdLandmarker = await FaceLandmarkerApi.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: publicAssetPath("/models/face_landmarker.task"),
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: true,
          minFaceDetectionConfidence: 0.5,
          minFacePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      } catch {
        if (!startupGate.isCurrent(startupToken)) {
          releasePendingResources();
          return;
        }
        createdLandmarker = await FaceLandmarkerApi.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: publicAssetPath("/models/face_landmarker.task"),
          },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: true,
        });
      }

      const committed = finalizeCameraStartup({
        gate: startupGate,
        token: startupToken,
        stream,
        landmarker: createdLandmarker,
        video,
        onCommit: () => {
          streamRef.current = stream;
          landmarkerRef.current = createdLandmarker;
          setEngineState("live");
          setEventMessage(zhCN.events.calibratingStill);
        },
      });
      if (!committed) {
        if (streamRef.current === stream) streamRef.current = null;
        if (landmarkerRef.current === createdLandmarker) {
          landmarkerRef.current = null;
        }
      }
    } catch {
      const isCurrent = startupGate.isCurrent(startupToken);
      releasePendingResources();
      if (!isCurrent) return;
      startupGate.invalidate("idle");
      setErrorMessage(zhCN.errors.modelLoadFailed);
      setEngineState("error");
      setEventMessage(zhCN.errors.modelLoadFailed);
    }
  };

  const stopCamera = () => {
    deactivateCurrentCamera("idle");
    setErrorMessage("");
    setEngineState("idle");
    setEventMessage(zhCN.events.waiting);
  };

  const startDemoMode = () => {
    deactivateCurrentCamera("demo");
    setErrorMessage("");
    setEngineState("demo");
    headRef.current = {
      cx: (canvasRef.current?.width ?? 900) / 2,
      cy: (canvasRef.current?.height ?? 650) * 0.52,
      rx: (canvasRef.current?.width ?? 900) * 0.14,
      ry: (canvasRef.current?.height ?? 650) * 0.22,
      rotation: 0,
      visible: true,
    };
    setTelemetry((previous) => ({
      ...previous,
      face: true,
      currentBurstCollisions: 0,
      sessionCollisions: 0,
      lastCollisionAgeMs: null,
      colliderTracked: true,
      collisionEnabled: true,
      laughIntensity: 0,
      rainEmission: false,
      rainIntensity: 0,
    }));
    trackerRef.current = createExpressionTracker();
    expressionDiagnosticsRef.current = {
      ...expressionDiagnosticsRef.current,
      laughIntensity: 0,
      candidateState: "neutral",
      candidateDurationMs: 0,
      faceTracked: true,
    };
    updateExpression("neutral");
    setEventMessage(zhCN.events.qaActive);
  };

  const simulateNeutral = () => {
    trackerRef.current = createExpressionTracker();
    smoothedRef.current = { smile: 0.04, jaw: 0.04, cheek: 0.04 };
    pendingLaughTriggerRef.current = false;
    laughEmissionRef.current = false;
    nextLaughFireworkAtRef.current = 0;
    laughIntensityRef.current = 0;
    rainSuppressedForLaughRef.current = false;
    rainIntensityRef.current = 0;
    expressionDiagnosticsRef.current = {
      ...expressionDiagnosticsRef.current,
      rawSmile: 0.04,
      smileLeft: 0.04,
      smileRight: 0.04,
      rawJaw: 0.04,
      cheekSquint: 0.04,
      smile: 0.04,
      jaw: 0.04,
      laughSmile: 0.04,
      laughIntensity: 0,
      candidateState: "neutral",
      candidateDurationMs: 0,
      faceTracked: true,
    };
    updateExpression("neutral");
    setTelemetry((previous) => ({
      ...previous,
      smile: 0.04,
      jaw: 0.04,
      face: true,
      candidateState: "neutral",
      stableState: "neutral",
      candidateDurationMs: 0,
      rainEmission: false,
      laughIntensity: 0,
      rainIntensity: 0,
      cooldownMs: 0,
    }));
  };

  const simulateSmile = () => {
    trackerRef.current = createExpressionTracker();
    smoothedRef.current = { smile: 0.78, jaw: 0.08, cheek: 0.28 };
    pendingLaughTriggerRef.current = false;
    laughEmissionRef.current = false;
    nextLaughFireworkAtRef.current = 0;
    laughIntensityRef.current = 0;
    rainSuppressedForLaughRef.current = false;
    rainIntensityRef.current = 1;
    expressionDiagnosticsRef.current = {
      ...expressionDiagnosticsRef.current,
      rawSmile: 0.78,
      smileLeft: 0.78,
      smileRight: 0.78,
      rawJaw: 0.08,
      cheekSquint: 0.28,
      smile: 0.78,
      jaw: 0.08,
      laughSmile: 0.78,
      laughIntensity: 0,
      candidateState: "smile",
      candidateDurationMs: 0,
      faceTracked: true,
    };
    updateExpression("smile");
    setTelemetry((previous) => ({
      ...previous,
      smile: 0.78,
      jaw: 0.08,
      face: true,
      candidateState: "smile",
      stableState: "smile",
      candidateDurationMs: 0,
      rainEmission: true,
      laughIntensity: 0,
      rainIntensity: 1,
    }));
  };

  const simulateLaugh = () => {
    smoothedRef.current = { smile: 0.9, jaw: 0.68, cheek: 0.62 };
    laughIntensityRef.current = 1;
    rainSuppressedForLaughRef.current = true;
    expressionDiagnosticsRef.current = {
      ...expressionDiagnosticsRef.current,
      rawSmile: 0.9,
      smileLeft: 0.9,
      smileRight: 0.9,
      rawJaw: 0.68,
      cheekSquint: 0.62,
      smile: 0.9,
      jaw: 0.68,
      laughSmile: 0.97,
      laughIntensity: 1,
      candidateState: "laugh",
      candidateDurationMs: 0,
      faceTracked: true,
    };
    setTelemetry((previous) => ({
      ...previous,
      smile: 0.9,
      jaw: 0.68,
      face: true,
      candidateState: "laugh",
      stableState: "laugh",
      candidateDurationMs: 0,
      rainEmission: false,
      laughIntensity: 1,
      rainIntensity: 0,
    }));
    enterLaugh();
  };

  const toggleDiagnostics = () => {
    if (showDiagnostics) {
      disableCollisionDebug();
      setShowDiagnostics(false);
      return;
    }
    setShowDiagnostics(true);
  };

  const toggleDebugMode = () => {
    const next = !debugModeRef.current;
    debugModeRef.current = next;
    setDebugModeEnabled(next);
    if (!next) {
      showHeadColliderRef.current = false;
      showCollisionEvidenceRef.current = false;
      setShowHeadCollider(false);
      setShowCollisionEvidence(false);
      resetCollisionEvidencePool(collisionEvidenceRef.current);
    }
  };

  const toggleDebugCollision = () => {
    const next = !debugCollisionRef.current;
    debugCollisionRef.current = next;
    setDebugCollisionEnabled(next);
    if (!next) resetCollisionEvidencePool(collisionEvidenceRef.current);
  };

  const toggleHeadCollider = () => {
    const next = !showHeadColliderRef.current;
    showHeadColliderRef.current = next;
    setShowHeadCollider(next);
  };

  const toggleCollisionEvidence = () => {
    const next = !showCollisionEvidenceRef.current;
    showCollisionEvidenceRef.current = next;
    setShowCollisionEvidence(next);
    if (!next) resetCollisionEvidencePool(collisionEvidenceRef.current);
  };

  const stateLabel =
    engineState === "live"
      ? telemetry.face
        ? zhCN.engineStates.faceLocked
        : zhCN.engineStates.searching
      : engineState === "demo"
        ? zhCN.engineStates.simulation
        : engineState === "loading"
          ? zhCN.engineStates.starting
          : zhCN.engineStates.offline;
  const lastCollisionLabel =
    telemetry.lastCollisionAgeMs === null
      ? zhCN.diagnostics.never
      : telemetry.lastCollisionAgeMs < 1000
        ? `${Math.round(telemetry.lastCollisionAgeMs)} ms`
        : `${(telemetry.lastCollisionAgeMs / 1000).toFixed(1)} s`;

  return (
    <main
      className={`experience state-${engineState} expression-${expression}`}
    >
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            J
          </span>
          <div>
            <p className="brand-name">{zhCN.brand.name}</p>
            <p className="brand-subtitle">{zhCN.brand.subtitle}</p>
          </div>
        </div>
        <div className="topbar-actions">
          <span
            className={`status-pill ${telemetry.face ? "is-live" : ""}`}
          >
            <span className="status-dot" />
            {stateLabel}
          </span>
          <button
            className="text-button"
            type="button"
            onClick={toggleDiagnostics}
            aria-pressed={showDiagnostics}
          >
            {showDiagnostics
              ? zhCN.topbar.hideDiagnostics
              : zhCN.topbar.showDiagnostics}
          </button>
        </div>
      </header>

      <section className="stage-shell" aria-label={zhCN.stage.label}>
        <div className="stage">
          <video
            ref={videoRef}
            className="camera-feed"
            muted
            playsInline
            aria-label={zhCN.stage.cameraLabel}
          />
          <div
            className="camera-fallback"
            aria-hidden={engineState === "live"}
          >
            <div className="demo-face">
              <span className="eye eye-left" />
              <span className="eye eye-right" />
              <span className="demo-mouth" />
            </div>
          </div>
          <canvas
            ref={canvasRef}
            className="effect-canvas"
            onPointerDown={triggerDebugFirework}
            data-firework-debug={debugModeEnabled ? "on" : "off"}
            data-firework-debug-collision={
              debugCollisionEnabled ? "on" : "off"
            }
            data-collision-enabled={
              !debugModeEnabled || debugCollisionEnabled ? "on" : "off"
            }
            style={
              debugModeEnabled
                ? { pointerEvents: "auto", cursor: "crosshair" }
                : undefined
            }
          />

          <div className="stage-vignette" />
          <div className="event-toast" role="status" aria-live="polite">
            <span
              className={`expression-icon icon-${expression}`}
              aria-hidden="true"
            />
            <span>{eventMessage}</span>
          </div>

          {showDiagnostics && (
            <aside className="diagnostics" aria-label={zhCN.diagnostics.label}>
              <div className="diagnostics-header">
                <span>{zhCN.diagnostics.signal}</span>
                <span>{telemetry.fps} FPS</span>
              </div>
              <Meter label={zhCN.diagnostics.smile} value={telemetry.smile} />
              <Meter label={zhCN.diagnostics.jaw} value={telemetry.jaw} />
              <div className="diagnostics-grid">
                <span>{zhCN.diagnostics.rawSmile}</span>
                <strong>{telemetry.rawSmile.toFixed(3)}</strong>
                <span>{zhCN.diagnostics.smoothedSmile}</span>
                <strong>{telemetry.smile.toFixed(3)}</strong>
                <span>{zhCN.diagnostics.smileSides}</span>
                <strong>
                  {telemetry.smileLeft.toFixed(2)} / {telemetry.smileRight.toFixed(2)}
                </strong>
                <span>{zhCN.diagnostics.jawOpen}</span>
                <strong>
                  {telemetry.rawJaw.toFixed(3)} / {telemetry.jaw.toFixed(3)}
                </strong>
                <span>{zhCN.diagnostics.cheekSquint}</span>
                <strong>{telemetry.cheekSquint.toFixed(3)}</strong>
                <span>{zhCN.diagnostics.laughComposite}</span>
                <strong>{telemetry.laughSmile.toFixed(3)}</strong>
                <span>{zhCN.diagnostics.laughIntensity}</span>
                <strong>{Math.round(telemetry.laughIntensity * 100)}%</strong>
                <span>{zhCN.diagnostics.candidateState}</span>
                <strong>{expressionLabel(telemetry.candidateState)}</strong>
                <span>{zhCN.diagnostics.stableState}</span>
                <strong>{expressionLabel(telemetry.stableState)}</strong>
                <span>{zhCN.diagnostics.candidateDuration}</span>
                <strong>{Math.round(telemetry.candidateDurationMs)} ms</strong>
                <span>{zhCN.diagnostics.smileThresholds}</span>
                <strong>
                  {telemetry.smileThreshold.toFixed(2)} / {telemetry.smileExitThreshold.toFixed(2)}
                </strong>
                <span>{zhCN.diagnostics.laughSmileThresholds}</span>
                <strong>
                  {telemetry.laughSmileThreshold.toFixed(2)} / {telemetry.laughSmileExitThreshold.toFixed(2)}
                </strong>
                <span>{zhCN.diagnostics.laughJawThresholds}</span>
                <strong>
                  {telemetry.laughJawThreshold.toFixed(2)} / {telemetry.laughJawExitThreshold.toFixed(2)}
                </strong>
                <span>{zhCN.diagnostics.rainEmission}</span>
                <strong>
                  {telemetry.rainEmission
                    ? zhCN.diagnostics.on
                    : zhCN.diagnostics.off}
                </strong>
                <span>{zhCN.diagnostics.rainIntensity}</span>
                <strong>{Math.round(telemetry.rainIntensity * 100)}%</strong>
                <span>{zhCN.diagnostics.cooldown}</span>
                <strong>{Math.ceil(telemetry.cooldownMs)} ms</strong>
                <span>{zhCN.diagnostics.faceTracking}</span>
                <strong>
                  {telemetry.face
                    ? zhCN.diagnostics.faceTracked
                    : zhCN.diagnostics.faceLost}
                </strong>
                <span>{zhCN.diagnostics.particles}</span>
                <strong>{telemetry.particles}</strong>
                <span>{zhCN.diagnostics.rainParticles}</span>
                <strong>{telemetry.rainParticles}</strong>
                <span>{zhCN.diagnostics.fireworkParticles}</span>
                <strong>{telemetry.fireworkParticles}</strong>
                <span>{zhCN.diagnostics.ripples}</span>
                <strong>{telemetry.ripples}</strong>
                <span>{zhCN.diagnostics.inference}</span>
                <strong>
                  {telemetry.inferenceFps} FPS
                </strong>
                <span>{zhCN.diagnostics.collider}</span>
                <strong>
                  {telemetry.face
                    ? zhCN.diagnostics.tracked
                    : zhCN.diagnostics.waiting}
                </strong>
              </div>
              <div className="collision-debug">
                <button
                  className="diagnostic-toggle"
                  type="button"
                  onClick={toggleDebugMode}
                  aria-pressed={debugModeEnabled}
                >
                  <span>{zhCN.diagnostics.debugMode}</span>
                  <strong>
                    {debugModeEnabled
                      ? zhCN.diagnostics.on
                      : zhCN.diagnostics.off}
                  </strong>
                </button>
                {debugModeEnabled && (
                  <>
                    <p className="collision-debug-hint">
                      {zhCN.diagnostics.debugHint}
                    </p>
                    <button
                      className="diagnostic-toggle"
                      type="button"
                      onClick={toggleDebugCollision}
                      aria-pressed={debugCollisionEnabled}
                    >
                      <span>{zhCN.diagnostics.collisionFunction}</span>
                      <strong>
                        {debugCollisionEnabled
                          ? zhCN.diagnostics.on
                          : zhCN.diagnostics.off}
                      </strong>
                    </button>
                    <button
                      className="diagnostic-toggle"
                      type="button"
                      onClick={toggleHeadCollider}
                      aria-pressed={showHeadCollider}
                    >
                      <span>{zhCN.diagnostics.showCollider}</span>
                      <strong>
                        {showHeadCollider
                          ? zhCN.diagnostics.on
                          : zhCN.diagnostics.off}
                      </strong>
                    </button>
                    <button
                      className="diagnostic-toggle"
                      type="button"
                      onClick={toggleCollisionEvidence}
                      aria-pressed={showCollisionEvidence}
                    >
                      <span>{zhCN.diagnostics.showEvidence}</span>
                      <strong>
                        {showCollisionEvidence
                          ? zhCN.diagnostics.on
                          : zhCN.diagnostics.off}
                      </strong>
                    </button>
                    <div className="collision-audit-grid">
                      <span>{zhCN.diagnostics.currentBurstCollisions}</span>
                      <strong>{telemetry.currentBurstCollisions}</strong>
                      <span>{zhCN.diagnostics.sessionCollisions}</span>
                      <strong>{telemetry.sessionCollisions}</strong>
                      <span>{zhCN.diagnostics.lastCollision}</span>
                      <strong>{lastCollisionLabel}</strong>
                      <span>{zhCN.diagnostics.colliderTracking}</span>
                      <strong>
                        {telemetry.colliderTracked
                          ? zhCN.diagnostics.tracked
                          : zhCN.diagnostics.waiting}
                      </strong>
                      <span>{zhCN.diagnostics.collisionStatus}</span>
                      <strong>
                        {telemetry.collisionEnabled
                          ? zhCN.diagnostics.on
                          : zhCN.diagnostics.off}
                      </strong>
                    </div>
                  </>
                )}
              </div>
            </aside>
          )}

          {(engineState === "idle" ||
            engineState === "loading" ||
            engineState === "error") && (
            <div className="permission-layer">
              <div className="permission-card">
                <span className="eyebrow">{zhCN.permission.eyebrow}</span>
                <h1>{zhCN.permission.title}</h1>
                <p className="permission-copy">
                  {zhCN.permission.description}
                </p>
                {engineState === "loading" && (
                  <p className="startup-status" role="status" aria-live="polite">
                    <span aria-hidden="true" />
                    {eventMessage}
                  </p>
                )}
                {errorMessage && (
                  <p className="error-message">{errorMessage}</p>
                )}
                <div className="permission-actions">
                  <button
                    className="primary-button"
                    type="button"
                    onClick={startCamera}
                    disabled={engineState === "loading"}
                  >
                    {engineState === "loading"
                      ? zhCN.permission.starting
                      : zhCN.permission.start}
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={startDemoMode}
                  >
                    {zhCN.permission.simulation}
                  </button>
                </div>
                <p className="privacy-note">
                  {zhCN.permission.privacy}
                </p>
              </div>
            </div>
          )}
        </div>

        <aside className="control-rail">
          <div className="rail-section">
            <span className="rail-label">{zhCN.signal.section}</span>
            <div className={`expression-readout is-${expression}`}>
              <span className="readout-orb" />
              <div>
                <strong>
                  {expression === "laugh"
                    ? zhCN.signal.laugh
                    : expression === "smile"
                      ? zhCN.signal.smile
                      : zhCN.signal.neutral}
                </strong>
                <p>
                  {expression === "laugh"
                    ? zhCN.signal.laughEffect
                    : expression === "smile"
                      ? zhCN.signal.smileEffect
                      : zhCN.signal.neutralEffect}
                </p>
              </div>
            </div>
          </div>

          <div className="rail-section">
            <span className="rail-label">{zhCN.qa.section}</span>
            <p className="rail-copy">{zhCN.qa.description}</p>
            <div className="qa-buttons">
              <button type="button" onClick={simulateNeutral}>
                {zhCN.qa.neutral}
              </button>
              <button type="button" onClick={simulateSmile}>
                {zhCN.qa.smile}
              </button>
              <button type="button" onClick={simulateLaugh}>
                {zhCN.qa.laugh}
              </button>
            </div>
          </div>

          <div className="rail-section">
            <span className="rail-label">{zhCN.performance.section}</span>
            <label className="quality-select">
              <span>{zhCN.performance.budget}</span>
              <select
                value={quality}
                onChange={(event) =>
                  setQuality(
                    event.target.value as "auto" | "high" | "lite",
                  )
                }
              >
                <option value="auto">{zhCN.performance.auto}</option>
                <option value="high">{zhCN.performance.high}</option>
                <option value="lite">{zhCN.performance.lite}</option>
              </select>
            </label>
          </div>

          {(engineState === "live" || engineState === "demo") && (
            <button
              className="stop-button"
              type="button"
              onClick={stopCamera}
            >
              {zhCN.actions.end}
            </button>
          )}
        </aside>
      </section>

      <footer className="footer-note">
        <span>{zhCN.footer.local}</span>
        <span>{zhCN.footer.stable}</span>
        <span>{zhCN.footer.physics}</span>
      </footer>
    </main>
  );
}
