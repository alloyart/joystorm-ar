import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(
  new URL("../app/page.tsx", import.meta.url),
  "utf8",
);
const cssSource = await readFile(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);
const collisionSource = await readFile(
  new URL("../app/firework-collision.mjs", import.meta.url),
  "utf8",
);

test("效果层使用受控粒子预算和较低画布倍率", () => {
  assert.match(pageSource, /auto:\s*400,\s*high:\s*460,\s*lite:\s*280/);
  assert.match(pageSource, /quality === "high" \? 1\.6 : 1\.35/);
  assert.doesNotMatch(pageSource, /shadowBlur\s*=\s*(?!0\b)\d/);
});

test("微笑效果包含高亮雨丝、SMILE 字母、漂散、涟漪与固定点阵池", () => {
  assert.match(pageSource, /"star"/);
  assert.match(pageSource, /"letter"/);
  assert.match(pageSource, /"drift"/);
  assert.match(pageSource, /createRipplePool/);
  assert.match(pageSource, /createImpactMatrixPool/);
  assert.match(pageSource, /MAX_IMPACT_MATRICES = 16/);
  assert.match(pageSource, /activateImpactMatrix/);
  assert.match(pageSource, /GLYPHS = \["S", "M", "I", "L", "E"\]/);
  assert.match(pageSource, /glyphIndexRef\.current\+\+/);
  assert.match(pageSource, /trailLength:\s*kind === "rain"/);
  assert.match(pageSource, /particle\.size \* 4\.6 \* dpr/);
});

test("大笑首次立即触发并在真实 Laugh 证据持续时定时续发烟花", () => {
  assert.match(pageSource, /createBurstRingPool/);
  assert.match(pageSource, /expressionRef\.current === "laugh"/);
  assert.match(pageSource, /pendingLaughTriggerRef\.current = true/);
  assert.match(pageSource, /laughEmissionRef\.current &&/);
  assert.match(pageSource, /now >= nextLaughFireworkAtRef\.current/);
  assert.match(pageSource, /FIREWORK_SUSTAIN_INTERVAL_MS = 820/);
  assert.match(pageSource, /FIREWORK_SUSTAIN_INTERVAL_LITE_MS = 1080/);
  assert.match(pageSource, /pendingLaughTriggerRef\.current = false;[\s\S]*spawnFirework\(\s*adaptiveLite \? 54 : 78/);
  assert.match(pageSource, /fireworkSequenceRef\.current/);
  assert.match(pageSource, /spawnFirework\(\s*adaptiveLite \? 54 : 78/);
  assert.match(pageSource, /burstRole: "main"/);
  assert.match(pageSource, /burstRole: "satellite"/);
  assert.match(pageSource, /collidesWithHead: false/);
  assert.match(pageSource, /delay: fastPreview \? 8 : 12/);
});

test("表情仲裁诊断低频采样且不增加推理或动画循环", () => {
  assert.match(pageSource, /mouthSmileLeft/);
  assert.match(pageSource, /mouthSmileRight/);
  assert.match(pageSource, /jawOpen/);
  assert.match(pageSource, /cheekSquintLeft/);
  assert.match(pageSource, /cheekSquintRight/);
  assert.match(pageSource, /expressionDiagnosticsRef\.current/);
  assert.match(pageSource, /candidateDurationMs/);
  assert.match(pageSource, /rainEmission/);
  assert.match(pageSource, /now - lastTelemetryRef\.current >= 320/);
  assert.equal((pageSource.match(/detectForVideo\(/g) ?? []).length, 1);
  assert.equal((pageSource.match(/function drawFrame|const drawFrame =/g) ?? []).length, 1);
});

test("烟花调试模式复用正式入口并可独立绕过碰撞", () => {
  assert.match(pageSource, /const FIREWORK_DEBUG_MODE = false/);
  assert.match(pageSource, /const FIREWORK_DEBUG_COLLISION = true/);
  assert.match(pageSource, /onPointerDown=\{triggerDebugFirework\}/);
  assert.match(pageSource, /canvas\.width \/ bounds\.width/);
  assert.match(pageSource, /canvas\.height \/ bounds\.height/);
  assert.match(pageSource, /spawnFirework\(78, true, \{/);
  assert.match(pageSource, /collisionEnabled: debugCollisionRef\.current/);
  assert.match(pageSource, /!debugModeRef\.current &&/);
  assert.match(pageSource, /collidesWithHead: debugTarget/);
});

test("碰撞验收工具复用真实事件、固定池和原动画循环", () => {
  assert.match(pageSource, /MAX_COLLISION_EVIDENCE_FLASHES = 24/);
  assert.match(pageSource, /COLLISION_EVIDENCE_DURATION_MS = 110/);
  assert.match(pageSource, /activateCollisionEvidenceFlash\([\s\S]*collisionEvidenceRef\.current,[\s\S]*collisionEvent/);
  assert.match(pageSource, /const captureCollisionEvent = \(event: FireworkCollisionEvent\)/);
  assert.match(pageSource, /if \(debugModeRef\.current\) recordCollisionEvidence\(event\)/);
  assert.match(pageSource, /currentBurstCollisions: collisionAudit\.currentBurstCollisions/);
  assert.match(pageSource, /now - lastTelemetryRef\.current >= 320/);
  assert.match(pageSource, /showHeadColliderRef\.current/);
  assert.match(pageSource, /data-collision-enabled/);
  assert.equal((pageSource.match(/detectForVideo\(/g) ?? []).length, 1);
  assert.equal((pageSource.match(/function drawFrame|const drawFrame =/g) ?? []).length, 1);
});

test("人脸碰撞使用 cover 映射、旋转椭圆和连续碰撞", () => {
  assert.match(pageSource, /mapCoverLandmark/);
  assert.match(pageSource, /video\.videoWidth/);
  assert.match(pageSource, /video\.videoHeight/);
  assert.match(pageSource, /smoothHeadCollider/);
  assert.match(pageSource, /rotation:\s*0/);
  assert.match(pageSource, /previousX\?: number/);
  assert.match(pageSource, /collisionArmed\?: boolean/);
  assert.match(pageSource, /collisionCooldown\?: number/);
  assert.match(pageSource, /collideFireworkParticle/);
});

test("烟花围绕面部展开并在尾段变为四芒星", () => {
  assert.match(pageSource, /head\.visible \? head\.cx/);
  assert.match(pageSource, /faceRadiusX \* 1\.72/);
  assert.match(pageSource, /faceRadiusY \* 1\.22/);
  assert.match(pageSource, /canvas\.width \* 0\.27/);
  assert.match(pageSource, /burstRadius/);
  assert.match(pageSource, /starMorphStart/);
  assert.match(pageSource, /const starProgress/);
  assert.match(pageSource, /drawStar/);
});

test("烟花残留层包含四芒星与 LAUGH 字母", () => {
  assert.match(pageSource, /LAUGH_GLYPHS = \["l", "a", "u", "g", "h"\]/);
  assert.match(pageSource, /layer === "residual"[\s\S]*layerIndex % 3 === 1/);
  assert.match(pageSource, /glyph: fireworkGlyph/);
  assert.match(pageSource, /fireworkDecoration/);
  assert.match(pageSource, /particle\.glyph[\s\S]*context\.fillText\(particle\.glyph/);
  assert.match(pageSource, /particle\.size \* 1\.9 \* dpr/);
  assert.match(pageSource, /particle\.size \* 2\.1 \* dpr/);
  assert.match(pageSource, /EFFECT_DECORATION_SIZE_MIN = 3\.8/);
  assert.match(pageSource, /EFFECT_DECORATION_SIZE_RANGE = 3/);
});

test("四芒星真实碰头后在同一循环生成有界非递归小烟花", () => {
  assert.match(pageSource, /MAX_MINI_FIREWORK_BURSTS_PER_FRAME = 4/);
  assert.match(pageSource, /MINI_FIREWORK_PARTICLE_COUNT = 20/);
  assert.match(pageSource, /function appendMiniFireworkBurst/);
  assert.match(pageSource, /particle\.collisionResponse === "miniBurst"/);
  assert.match(collisionSource, /contactX: boundary\.x/);
  assert.match(pageSource, /seed\.contactX \+ seed\.normalX \* 2/);
  assert.match(pageSource, /fireworkLayer: "secondary"/);
  assert.match(pageSource, /collidesWithHead: false/);
  assert.equal((pageSource.match(/function drawFrame|const drawFrame =/g) ?? []).length, 1);
});

test("Laugh 原始前置抢占阻断新雨滴，大笑幅度只向上扩张 v24 半径", () => {
  assert.match(pageSource, /isLaughPreemptCandidate\(laughSmileRaw, jawRaw, baseline\)/);
  assert.match(pageSource, /const suppressRain =[\s\S]*laughPreempt/);
  assert.match(pageSource, /expressionRef\.current === "smile" &&[\s\S]*!rainSuppressedForLaughRef\.current/);
  assert.match(pageSource, /const baseBurstRadius = clamp/);
  assert.match(pageSource, /baseBurstRadius \* \(1 \+ clamp\(laughIntensity, 0, 1\) \* 0\.38\)/);
  assert.match(pageSource, /baseBurstRadius,[\s\S]*canvas\.width \* 0\.37/);
  assert.match(pageSource, /normalizeLaughIntensity/);
});

test("抿嘴 Smile 与张嘴 Laugh 互斥，真实张嘴帧立即控制烟花续发", () => {
  assert.match(pageSource, /const laughSmileEvidence = Math\.max\(laughSmile, laughSmileRaw\)/);
  assert.match(pageSource, /const laughJawEvidence = Math\.max\(jaw, jawRaw\)/);
  assert.match(pageSource, /canClassify && laughPreempt && decision\.gates\.laughContinuous/);
  assert.match(pageSource, /jawRaw > decision\.thresholds\.smileJawEnterMax/);
  assert.match(pageSource, /jaw > decision\.thresholds\.smileJawExitMax/);
  assert.match(pageSource, /rainSuppressedForLaughRef\.current/);
});

test("所有烟花提速且尺寸越大绽放越慢、持续越久", () => {
  assert.match(pageSource, /previousPeakSpeed/);
  assert.match(pageSource, /1\.22 - sizeProgress \* 0\.14/);
  assert.match(pageSource, /\(satellite \? 1\.24 : 1\.28 - sizeProgress \* 0\.16\) \*[\s\S]*burstRateVariation/);
  assert.match(pageSource, /lifeScale = satellite \? 0\.94 : 0\.94 \+ sizeProgress \* 0\.34/);
  assert.match(pageSource, /baseDelay \/ burstTempo/);
  assert.match(pageSource, /burstRateVariation: 0\.985 \+ Math\.random\(\) \* 0\.03/);
  assert.match(pageSource, /baseLateDrag \+ \(1 - baseLateDrag\) \* sizeProgress \* 0\.58/);
});

test("参考烟花使用分层短时发射与受控密度", () => {
  assert.match(pageSource, /type FireworkLayer = "primary" \| "secondary" \| "residual"/);
  assert.match(pageSource, /FIREWORK_MAIN_DENSITY = 3\.25/);
  assert.match(pageSource, /Math\.round\(amount \* FIREWORK_MAIN_DENSITY\)/);
  assert.match(pageSource, /FIREWORK_LAYER_RATIO/);
  assert.match(pageSource, /const clusterCount = satellite \? 9 : 28/);
  assert.match(pageSource, /const clusterAngle/);
  assert.match(pageSource, /const goldenAngle/);
  assert.match(pageSource, /const usesLocalBundle/);
  assert.match(pageSource, /layer === "secondary"[\s\S]*4 \+ Math\.random\(\)/);
  assert.match(pageSource, /layer === "residual"/);
});

test("参考烟花使用延迟重力、阶段阻力与有界历史尾迹", () => {
  assert.match(pageSource, /trail\?: TrailPoint\[\]/);
  assert.match(pageSource, /trailCapacity\?: number/);
  assert.match(pageSource, /lateDrag\?: number/);
  assert.match(pageSource, /gravityDelay\?: number/);
  assert.match(pageSource, /const dragTransition = smoothstep/);
  assert.match(pageSource, /const gravityInfluence = smoothstep/);
  assert.match(pageSource, /trail\.splice\(0, trail\.length - visibleTrailCapacity\)/);
  assert.match(pageSource, /drawFireworkTrail/);
});

test("烟花继承单次爆炸主色并使用高饱和窄色相抖动", () => {
  assert.match(pageSource, /function fireworkColor\(layer: FireworkLayer, baseHue: number\)/);
  assert.match(pageSource, /saturationFloor/);
  assert.match(pageSource, /fireworkColor\(layer, rocket\.hue\)/);
  assert.match(pageSource, /activateBurstRing\([\s\S]*rocket\.hue/);
  assert.match(pageSource, /const fireworkAlpha = clamp/);
  assert.match(pageSource, /const brightness = clamp/);
  assert.match(pageSource, /halo\.addColorStop\(0, `hsla\(48, 12%, 100%/);
  assert.match(pageSource, /Math\.min\(52, saturation\)/);
});

test("雨量和下落速度由同一微笑强度单调驱动", () => {
  assert.match(pageSource, /normalizeSmileIntensity/);
  assert.match(pageSource, /1 \+ Math\.floor\(smileIntensity \* 5\.999\)/);
  assert.match(pageSource, /speedMultiplier = 0\.78 \+ smileIntensity \* 1\.12/);
  assert.match(pageSource, /spawnRain\(rainCount, engineState === "demo", smileIntensity\)/);
});

test("界面使用截图实测蓝色形成蓝白渐变", () => {
  assert.match(cssSource, /--reference-blue:\s*#2f67f1/);
  assert.match(cssSource, /--reference-blue-mid:\s*#578cf4/);
  assert.match(cssSource, /--reference-blue-light:\s*#7bacf5/);
  assert.match(cssSource, /linear-gradient\(155deg/);
  assert.match(cssSource, /#eaf3ff 84%, #ffffff 100%/);
  assert.match(cssSource, /padding:\s*24px/);
  assert.match(cssSource, /grid-template-columns:\s*minmax\(0, 1fr\) 254px/);
  assert.match(cssSource, /@media \(max-width: 680px\)/);
});
