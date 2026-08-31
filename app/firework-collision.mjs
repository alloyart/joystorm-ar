export const FIREWORK_COLLISION_CONFIG = Object.freeze({
  collisionStartProgress: 0.58,
  collisionEndProgress: 0.86,
  primaryMaxBounces: 1,
  primarySpeedRetention: 0.68,
  primaryTangentRetention: 0.76,
  primaryNormalDeflection: 0.12,
  primaryTangentBias: 0.14,
  primaryCooldownFrames: 8,
  starBloomMinProgress: 0.52,
  starBloomEndProgress: 0.96,
});

export function getFireworkCollisionPhase(progress) {
  if (progress < FIREWORK_COLLISION_CONFIG.collisionStartProgress) {
    return "expansion";
  }
  if (progress <= FIREWORK_COLLISION_CONFIG.collisionEndProgress) {
    return "interaction";
  }
  return "decay";
}

/**
 * Maps a MediaPipe normalized landmark into the same coordinate space as a
 * mirrored <video> rendered with object-fit: cover.
 */
export function mapCoverLandmark({
  x,
  y,
  canvasWidth,
  canvasHeight,
  videoWidth,
  videoHeight,
  mirrored = true,
}) {
  const safeVideoWidth = videoWidth > 0 ? videoWidth : canvasWidth;
  const safeVideoHeight = videoHeight > 0 ? videoHeight : canvasHeight;
  const scale = Math.max(
    canvasWidth / Math.max(1, safeVideoWidth),
    canvasHeight / Math.max(1, safeVideoHeight),
  );
  const renderedWidth = safeVideoWidth * scale;
  const renderedHeight = safeVideoHeight * scale;
  const cropX = (renderedWidth - canvasWidth) / 2;
  const cropY = (renderedHeight - canvasHeight) / 2;
  const visibleX = x * renderedWidth - cropX;

  return {
    x: mirrored ? canvasWidth - visibleX : visibleX,
    y: y * renderedHeight - cropY,
  };
}

function normalizeEllipseAngle(angle) {
  let next = angle;
  while (next > Math.PI / 2) next -= Math.PI;
  while (next <= -Math.PI / 2) next += Math.PI;
  return next;
}

function lerpEllipseAngle(from, to, amount) {
  let difference = normalizeEllipseAngle(to) - normalizeEllipseAngle(from);
  if (difference > Math.PI / 2) difference -= Math.PI;
  if (difference < -Math.PI / 2) difference += Math.PI;
  return normalizeEllipseAngle(from + difference * amount);
}

/** Smooths detector jitter without freezing the collider during head motion. */
export function smoothHeadCollider(previous, next) {
  if (!previous?.visible) return next;

  const movement = Math.hypot(next.cx - previous.cx, next.cy - previous.cy);
  const movementRatio = movement / Math.max(1, previous.rx);
  const centerAlpha = movementRatio > 0.7 ? 0.72 : 0.42;
  const sizeAlpha = movementRatio > 0.7 ? 0.58 : 0.3;
  const rotationAlpha = movementRatio > 0.7 ? 0.58 : 0.34;

  return {
    cx: previous.cx + (next.cx - previous.cx) * centerAlpha,
    cy: previous.cy + (next.cy - previous.cy) * centerAlpha,
    rx: previous.rx + (next.rx - previous.rx) * sizeAlpha,
    ry: previous.ry + (next.ry - previous.ry) * sizeAlpha,
    rotation: lerpEllipseAngle(
      previous.rotation ?? 0,
      next.rotation ?? 0,
      rotationAlpha,
    ),
    visible: true,
  };
}

function toEllipseLocal(x, y, head, rx, ry) {
  const rotation = head.rotation ?? 0;
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const dx = x - head.cx;
  const dy = y - head.cy;
  return {
    x: (dx * cosine + dy * sine) / rx,
    y: (-dx * sine + dy * cosine) / ry,
  };
}

function localBoundaryToWorld(localX, localY, head, rx, ry) {
  const rotation = head.rotation ?? 0;
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const x = localX * rx;
  const y = localY * ry;
  return {
    x: head.cx + x * cosine - y * sine,
    y: head.cy + x * sine + y * cosine,
  };
}

function findSegmentEllipseHit(start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const a = dx * dx + dy * dy;
  const b = 2 * (start.x * dx + start.y * dy);
  const c = start.x * start.x + start.y * start.y - 1;
  if (a < 1e-8) return null;

  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const first = (-b - root) / (2 * a);
  const second = (-b + root) / (2 * a);
  const time = [first, second].find((candidate) => candidate >= 0 && candidate <= 1);
  if (time === undefined) return null;
  return {
    x: start.x + dx * time,
    y: start.y + dy * time,
  };
}

/**
 * Continuous segment-vs-ellipse collision for firework particles. The
 * particle is mutated in-place to preserve the existing animation interface.
 */
export function collideFireworkParticle(
  particle,
  head,
  onCollision,
  timestamp = 0,
) {
  const layer = particle.fireworkLayer ?? "primary";
  const progress = 1 - Math.max(0, Math.min(1, particle.life / particle.maxLife));
  const phase = getFireworkCollisionPhase(progress);
  const isPrimaryParticle = layer === "primary";
  const isFallingBloomStar =
    layer === "residual" &&
    particle.fireworkDecoration === "star" &&
    particle.collisionResponse === "miniBurst" &&
    particle.glyph === undefined &&
    progress >=
      Math.max(
        FIREWORK_COLLISION_CONFIG.starBloomMinProgress,
        particle.starMorphStart ?? 0.62,
      );

  if (
    !head.visible ||
    particle.kind !== "firework" ||
    particle.collidesWithHead === false ||
    (!isPrimaryParticle && !isFallingBloomStar) ||
    (particle.collisionCooldown ?? 0) > 0 ||
    particle.bounces >= FIREWORK_COLLISION_CONFIG.primaryMaxBounces
  ) {
    return false;
  }

  if (phase === "expansion") {
    particle.collisionArmed = false;
    return false;
  }
  if (
    phase === "decay" &&
    !(
      isFallingBloomStar &&
      progress <= FIREWORK_COLLISION_CONFIG.starBloomEndProgress
    )
  ) {
    return false;
  }

  const expansion = Math.max(1.5, (particle.size ?? 1) * 1.25);
  const rx = Math.max(1, head.rx + expansion);
  const ry = Math.max(1, head.ry + expansion);
  const start = toEllipseLocal(
    particle.previousX ?? particle.x - particle.vx,
    particle.previousY ?? particle.y - particle.vy,
    head,
    rx,
    ry,
  );
  const end = toEllipseLocal(particle.x, particle.y, head, rx, ry);
  const startInside = start.x * start.x + start.y * start.y < 1;
  const endInside = end.x * end.x + end.y * end.y < 1;
  if (particle.collisionArmed !== true) {
    if (!startInside && !endInside) particle.collisionArmed = true;
    return false;
  }
  if (startInside) {
    // A collider that moves over an existing particle must not push it out.
    // Re-arm only after the particle has naturally left the head region.
    particle.collisionArmed = false;
    return false;
  }

  const hit = findSegmentEllipseHit(start, end);
  if (!hit) return false;

  const hitLength = Math.hypot(hit.x, hit.y) || 1;
  const boundaryX = hit.x / hitLength;
  const boundaryY = hit.y / hitLength;
  const boundary = localBoundaryToWorld(boundaryX, boundaryY, head, rx, ry);

  const rotation = head.rotation ?? 0;
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  let localNormalX = boundaryX / rx;
  let localNormalY = boundaryY / ry;
  const localNormalLength = Math.hypot(localNormalX, localNormalY) || 1;
  localNormalX /= localNormalLength;
  localNormalY /= localNormalLength;
  const normalX = localNormalX * cosine - localNormalY * sine;
  const normalY = localNormalX * sine + localNormalY * cosine;
  const tangentX = -normalY;
  const tangentY = normalX;

  const incomingNormal = particle.vx * normalX + particle.vy * normalY;
  const incomingTangent = particle.vx * tangentX + particle.vy * tangentY;
  const preCollisionSpeed = Math.hypot(particle.vx, particle.vy);
  if (incomingNormal >= -0.01 || preCollisionSpeed < 0.05) return false;

  const variance = Math.sin(
    (particle.flickerPhase ?? 0) + particle.bounces * 2.17,
  );
  const tangentDirection = variance >= 0 ? 1 : -1;
  const outwardNormal = Math.max(
    preCollisionSpeed * 0.05,
    -incomingNormal * FIREWORK_COLLISION_CONFIG.primaryNormalDeflection,
  );
  const tangentBias =
    preCollisionSpeed *
    FIREWORK_COLLISION_CONFIG.primaryTangentBias *
    tangentDirection *
    (0.82 + Math.abs(variance) * 0.18);
  const outgoingTangent =
    incomingTangent * FIREWORK_COLLISION_CONFIG.primaryTangentRetention +
    tangentBias;
  particle.vx = normalX * outwardNormal + tangentX * outgoingTangent;
  particle.vy = normalY * outwardNormal + tangentY * outgoingTangent;

  const directionLength = Math.hypot(particle.vx, particle.vy) || 1;
  const targetSpeed =
    preCollisionSpeed *
    (FIREWORK_COLLISION_CONFIG.primarySpeedRetention + variance * 0.035);
  particle.vx = (particle.vx / directionLength) * targetSpeed;
  particle.vy = (particle.vy / directionLength) * targetSpeed;

  const padding = 1.5 + (particle.size ?? 1) * 0.9;
  particle.x = boundary.x + normalX * padding;
  particle.y = boundary.y + normalY * padding;
  particle.previousX = particle.x;
  particle.previousY = particle.y;
  particle.bounces += 1;
  particle.collisionArmed = false;
  particle.collisionCooldown =
    FIREWORK_COLLISION_CONFIG.primaryCooldownFrames;
  if (onCollision && particle.collisionEventRecorded !== true) {
    particle.collisionEventRecorded = true;
    onCollision({
      particleId: particle.particleId ?? -1,
      contactX: boundary.x,
      contactY: boundary.y,
      normalX,
      normalY,
      timestamp,
      burstId: particle.burstId ?? -1,
    });
  }
  return true;
}
