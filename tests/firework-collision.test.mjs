import assert from "node:assert/strict";
import test from "node:test";

import {
  collideFireworkParticle,
  FIREWORK_COLLISION_CONFIG,
  getFireworkCollisionPhase,
  mapCoverLandmark,
  smoothHeadCollider,
} from "../app/firework-collision.mjs";

const head = {
  cx: 100,
  cy: 100,
  rx: 40,
  ry: 55,
  rotation: 0,
  visible: true,
};

function particle(overrides = {}) {
  return {
    kind: "firework",
    fireworkLayer: "primary",
    x: 150,
    y: 100,
    previousX: 50,
    previousY: 100,
    vx: 12,
    vy: 0,
    size: 1,
    life: 38,
    maxLife: 100,
    bounces: 0,
    collisionArmed: true,
    collidesWithHead: true,
    trail: [],
    ...overrides,
  };
}

test("cover 坐标映射与镜像视频保持一致", () => {
  const center = mapCoverLandmark({
    x: 0.5,
    y: 0.5,
    canvasWidth: 1000,
    canvasHeight: 500,
    videoWidth: 640,
    videoHeight: 480,
  });
  assert.deepEqual(center, { x: 500, y: 250 });

  const quarter = mapCoverLandmark({
    x: 0.25,
    y: 0.5,
    canvasWidth: 1000,
    canvasHeight: 500,
    videoWidth: 640,
    videoHeight: 480,
  });
  assert.equal(quarter.x, 750);
});

test("横竖屏 cover 裁切与镜像始终使用同一画布坐标系", () => {
  for (const [canvasWidth, canvasHeight] of [
    [390, 844],
    [844, 390],
    [1280, 720],
  ]) {
    const common = {
      x: 0.2,
      y: 0.34,
      canvasWidth,
      canvasHeight,
      videoWidth: 640,
      videoHeight: 480,
    };
    const mirrored = mapCoverLandmark({ ...common, mirrored: true });
    const unmirrored = mapCoverLandmark({ ...common, mirrored: false });
    assert.ok(Math.abs(mirrored.x + unmirrored.x - canvasWidth) < 1e-8);
    assert.equal(mirrored.y, unmirrored.y);

    const center = mapCoverLandmark({ ...common, x: 0.5, y: 0.5 });
    assert.ok(Math.abs(center.x - canvasWidth / 2) < 1e-8);
    assert.ok(Math.abs(center.y - canvasHeight / 2) < 1e-8);
  }
});

test("高速粒子跨越整个头部时不会穿透", () => {
  const candidate = particle();
  assert.equal(collideFireworkParticle(candidate, head), true);
  assert.equal(candidate.bounces, 1);
  assert.ok(candidate.x < 100);
  assert.ok(candidate.vx < 0);
  assert.ok(candidate.collisionCooldown > 0);
  const retention = Math.hypot(candidate.vx, candidate.vy) / 12;
  assert.ok(retention >= 0.55 && retention <= 0.8);
});

test("旋转碰撞椭圆仍能给出正确的反射方向", () => {
  const candidate = particle({
    x: 100,
    y: 180,
    previousX: 100,
    previousY: 20,
    vx: 0,
    vy: 12,
  });
  assert.equal(
    collideFireworkParticle(candidate, { ...head, rotation: Math.PI / 2 }),
    true,
  );
  assert.ok(candidate.y < head.cy);
  assert.ok(candidate.vy < 0);
});

test("碰撞后冷却避免同一粒子连续重复反弹", () => {
  const candidate = particle();
  assert.equal(collideFireworkParticle(candidate, head), true);
  const firstVelocity = candidate.vx;
  assert.equal(collideFireworkParticle(candidate, head), false);
  assert.equal(candidate.vx, firstVelocity);
  assert.equal(candidate.bounces, 1);
});

test("真实碰撞成功分支只输出一次接触事件", () => {
  const candidate = particle({ particleId: 73, burstId: 11 });
  const events = [];
  assert.equal(
    collideFireworkParticle(candidate, head, (event) => events.push(event), 1234),
    true,
  );
  assert.equal(events.length, 1);
  assert.deepEqual(Object.keys(events[0]), [
    "particleId",
    "contactX",
    "contactY",
    "normalX",
    "normalY",
    "timestamp",
    "burstId",
  ]);
  assert.equal(events[0].particleId, 73);
  assert.equal(events[0].burstId, 11);
  assert.equal(events[0].timestamp, 1234);
  assert.ok(Number.isFinite(events[0].contactX));
  assert.ok(Number.isFinite(events[0].contactY));
  assert.ok(Math.abs(Math.hypot(events[0].normalX, events[0].normalY) - 1) < 1e-8);

  assert.equal(
    collideFireworkParticle(candidate, head, (event) => events.push(event), 1240),
    false,
  );
  assert.equal(events.length, 1);
});

test("主粒子与已显形的飘落四芒星复用同一真实碰撞", () => {
  assert.equal(
    collideFireworkParticle(particle({ fireworkLayer: "secondary" }), head),
    false,
  );
  assert.equal(
    collideFireworkParticle(particle({ fireworkLayer: "residual" }), head),
    false,
  );
  assert.equal(
    collideFireworkParticle(particle({ collidesWithHead: false }), head),
    false,
  );

  const star = particle({
    particleId: 91,
    burstId: 7,
    fireworkLayer: "residual",
    fireworkDecoration: "star",
    collisionResponse: "miniBurst",
    starMorphStart: 0.62,
  });
  const events = [];
  assert.equal(
    collideFireworkParticle(star, head, (event) => events.push(event), 2468),
    true,
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].particleId, 91);
  assert.equal(events[0].burstId, 7);
  assert.equal(events[0].timestamp, 2468);
});

test("字母、未显形四芒星和小烟花不会触发递归碰撞", () => {
  assert.equal(
    collideFireworkParticle(
      particle({
        fireworkLayer: "residual",
        fireworkDecoration: "letter",
        collisionResponse: "miniBurst",
        glyph: "l",
      }),
      head,
    ),
    false,
  );
  assert.equal(
    collideFireworkParticle(
      particle({
        fireworkLayer: "residual",
        fireworkDecoration: "star",
        collisionResponse: "miniBurst",
        starMorphStart: 0.7,
      }),
      head,
    ),
    false,
  );
  assert.equal(
    collideFireworkParticle(
      particle({
        fireworkLayer: "secondary",
        collidesWithHead: false,
      }),
      head,
    ),
    false,
  );
});

test("完全显形后飘落的四芒星在主粒子衰减阶段仍可碰头开花", () => {
  const star = particle({
    particleId: 104,
    burstId: 13,
    fireworkLayer: "residual",
    fireworkDecoration: "star",
    collisionResponse: "miniBurst",
    starMorphStart: 0.5,
    life: 8,
    maxLife: 100,
  });
  const events = [];
  assert.equal(getFireworkCollisionPhase(0.92), "decay");
  assert.equal(
    collideFireworkParticle(star, head, (event) => events.push(event), 3200),
    true,
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].particleId, 104);
});

test("交互阶段开始时已在人脸内的粒子不会被集体推出", () => {
  const candidate = particle({
    x: 110,
    y: 100,
    previousX: 100,
    previousY: 100,
    vx: 10,
    vy: 0,
  });
  assert.equal(collideFireworkParticle(candidate, head), false);
  assert.equal(candidate.x, 110);
  assert.equal(candidate.vx, 10);
  assert.equal(candidate.collisionArmed, false);
});

test("展开阶段完全关闭碰撞并保持原始爆炸轨迹", () => {
  const candidate = particle({ life: 70, x: 150, previousX: 50 });
  assert.equal(getFireworkCollisionPhase(0.3), "expansion");
  assert.equal(collideFireworkParticle(candidate, head), false);
  assert.equal(candidate.x, 150);
  assert.equal(candidate.vx, 12);
  assert.equal(candidate.bounces, 0);
  assert.equal(candidate.collisionArmed, false);
});

test("离开人脸区域后才为后期局部接触启用碰撞", () => {
  const candidate = particle({
    x: 170,
    previousX: 160,
    collisionArmed: false,
  });
  assert.equal(collideFireworkParticle(candidate, head), false);
  assert.equal(candidate.collisionArmed, true);
});

test("生命周期明确分为展开、交互和衰减三个碰撞阶段", () => {
  assert.equal(
    getFireworkCollisionPhase(
      FIREWORK_COLLISION_CONFIG.collisionStartProgress - 0.01,
    ),
    "expansion",
  );
  assert.equal(
    getFireworkCollisionPhase(
      FIREWORK_COLLISION_CONFIG.collisionStartProgress + 0.01,
    ),
    "interaction",
  );
  assert.equal(
    getFireworkCollisionPhase(
      FIREWORK_COLLISION_CONFIG.collisionEndProgress + 0.01,
    ),
    "decay",
  );
});

test("碰撞体平滑能抑制小幅抖动并跟随大幅移动", () => {
  const smallMove = smoothHeadCollider(head, {
    ...head,
    cx: 104,
    cy: 103,
    rx: 42,
  });
  assert.ok(smallMove.cx > 100 && smallMove.cx < 104);
  assert.ok(smallMove.rx > 40 && smallMove.rx < 42);

  const largeMove = smoothHeadCollider(head, {
    ...head,
    cx: 150,
    cy: 100,
  });
  assert.ok(largeMove.cx > 130);
});
