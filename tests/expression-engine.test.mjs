import assert from "node:assert/strict";
import test from "node:test";

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
} from "../app/expression-engine.mjs";

const baseline = { smile: 0.05, jaw: 0.04, cheek: 0.04 };

function createRuntime(current = "neutral") {
  return {
    current,
    tracker: createExpressionTracker(),
    enteredLaughCount: 0,
  };
}

function step(
  runtime,
  {
    smile,
    laughSmile = smile,
    jaw,
    now,
    canClassify = true,
    smileResumeAt = 0,
    laughCooldownUntil = -Infinity,
    laughPreempt = false,
  },
) {
  const decision = advanceExpressionState({
    current: runtime.current,
    smile,
    laughSmile,
    jaw,
    baseline,
    tracker: runtime.tracker,
    canClassify,
    now,
    smileResumeAt,
    laughCooldownUntil,
    laughPreempt,
  });
  runtime.current = decision.next;
  runtime.tracker = decision.tracker;
  if (decision.enteredLaugh) runtime.enteredLaughCount += 1;
  return decision;
}

function hold(runtime, evidence, start, duration, interval = 80) {
  let decision;
  for (let now = start; now <= start + duration; now += interval) {
    decision = step(runtime, { ...evidence, now });
  }
  return decision;
}

test("A Neutral：自然放松八秒保持中性", () => {
  const runtime = createRuntime();
  hold(runtime, { smile: 0.055, jaw: 0.05 }, 0, 8000);
  assert.equal(runtime.current, "neutral");
  assert.equal(runtime.enteredLaughCount, 0);
});

test("B 微小闭嘴微笑：一次有效推理立即进入 Smile", () => {
  const runtime = createRuntime();
  const decision = step(runtime, {
    smile: 0.072,
    laughSmile: 0.074,
    jaw: 0.09,
    now: 0,
  });
  assert.equal(runtime.current, "smile");
  assert.equal(decision.candidateDurationMs, 0);
  assert.equal(runtime.enteredLaughCount, 0);
});

test("C 张嘴但不笑：jawOpen 不能单独触发 Laugh", () => {
  const runtime = createRuntime();
  hold(runtime, { smile: 0.055, laughSmile: 0.057, jaw: 0.72 }, 0, 3000);
  assert.equal(runtime.current, "neutral");
  assert.equal(runtime.enteredLaughCount, 0);
});

test("D/F 自然且持续大笑：Laugh 抢占且只产生一次进入边沿", () => {
  const runtime = createRuntime();
  hold(runtime, { smile: 0.72, laughSmile: 0.78, jaw: 0.58 }, 0, 3200);
  assert.equal(runtime.current, "laugh");
  assert.equal(runtime.enteredLaughCount, 1);
});

test("E Smile → Laugh：直接稳定抢占，不回落到 Neutral", () => {
  const runtime = createRuntime();
  hold(runtime, { smile: 0.62, laughSmile: 0.65, jaw: 0.08 }, 0, 480);
  assert.equal(runtime.current, "smile");

  const states = [];
  for (let now = 560; now <= 960; now += 80) {
    step(runtime, { smile: 0.74, laughSmile: 0.8, jaw: 0.6, now });
    states.push(runtime.current);
  }
  assert.equal(runtime.current, "laugh");
  assert.equal(runtime.enteredLaughCount, 1);
  assert.equal(states.includes("neutral"), false);
});

test("G Laugh → Neutral → 再次张嘴笑可立即重新触发", () => {
  const runtime = createRuntime();
  hold(runtime, { smile: 0.74, laughSmile: 0.8, jaw: 0.6 }, 0, 240);
  assert.equal(runtime.current, "laugh");

  hold(runtime, { smile: 0.055, jaw: 0.05 }, 320, 400);
  assert.equal(runtime.current, "neutral");

  assert.equal(EXPRESSION_CONFIG.laughCooldownMs, 0);
  hold(runtime, { smile: 0.74, laughSmile: 0.8, jaw: 0.6 }, 800, 80);
  assert.equal(runtime.current, "laugh");
  assert.equal(runtime.enteredLaughCount, 2);
});

test("H 干扰：单侧嘴角、说话及丢脸不会触发烟花", () => {
  assert.ok(combineSmileSides(0.82, 0.08) < 0.48);
  assert.equal(combineLaughSmile(0.18, 0.08, 0.04) < 0.48, true);

  const runtime = createRuntime();
  hold(runtime, { smile: 0.055, laughSmile: 0.057, jaw: 0.55 }, 0, 240);
  assert.equal(runtime.current, "neutral");

  const lost = step(runtime, {
    smile: 0.9,
    laughSmile: 0.96,
    jaw: 0.7,
    now: 260,
    canClassify: false,
  });
  assert.equal(lost.next, "neutral");
  assert.equal(lost.enteredLaugh, false);
});

test("Smile/Laugh 进入均在首次有效推理立即完成", () => {
  for (const interval of [40, 80, 110]) {
    const runtime = createRuntime();
    let enteredAt = null;
    for (let now = 0; now <= 600; now += interval) {
      const decision = step(runtime, {
        smile: 0.72,
        laughSmile: 0.78,
        jaw: 0.58,
        now,
      });
      if (decision.enteredLaugh) enteredAt = now;
    }
    assert.equal(enteredAt, 0);
  }
});

test("低 Smile 进入阈值保留退出迟滞和中性基线自适应", () => {
  const thresholds = getExpressionThresholds(baseline);
  assert.equal(thresholds.smileEnter, 0.068);
  assert.equal(EXPRESSION_CONFIG.smileConfirmMs, 0);
  assert.equal(EXPRESSION_CONFIG.laughConfirmMs, 0);
  assert.ok(thresholds.smileEnter > thresholds.smileExit);
  assert.ok(thresholds.laughSmileEnter > thresholds.laughSmileExit);
  assert.ok(thresholds.laughJawEnter > thresholds.laughJawExit);
  assert.ok(thresholds.smileJawEnterMax < thresholds.laughJawEnter);
});

test("只有抿嘴微笑进入 Smile，同等笑意张嘴后由 Laugh 抢占", () => {
  const closedMouth = createRuntime();
  step(closedMouth, {
    smile: 0.18,
    laughSmile: 0.18,
    jaw: 0.08,
    now: 0,
  });
  assert.equal(closedMouth.current, "smile");

  const openMouth = createRuntime();
  const decision = step(openMouth, {
    smile: 0.18,
    laughSmile: 0.18,
    jaw: 0.16,
    now: 0,
  });
  assert.equal(openMouth.current, "laugh");
  assert.equal(decision.gates.smileEvidence, false);
});

test("雨水强度随 Smile 单调增长并保持 0–1 有界", () => {
  const weak = normalizeSmileIntensity(0.08, baseline);
  const medium = normalizeSmileIntensity(0.36, baseline);
  const strong = normalizeSmileIntensity(0.78, baseline);
  assert.ok(weak > 0);
  assert.ok(medium > weak);
  assert.ok(strong > medium);
  assert.equal(strong, 1);
});

test("原始张嘴笑证据在同一推理帧抢占 Smile", () => {
  assert.equal(isLaughPreemptCandidate(0.08, 0.15, baseline), true);
  assert.equal(isLaughPreemptCandidate(0.4, 0.12, baseline), false);
  assert.equal(isLaughPreemptCandidate(0.055, 0.64, baseline), false);

  const runtime = createRuntime();
  const preempted = step(runtime, {
    smile: 0.08,
    laughSmile: 0.08,
    jaw: 0.15,
    laughPreempt: true,
    now: 0,
  });
  assert.equal(runtime.current, "laugh");
  assert.equal(preempted.gates.smileEvidence, false);
  assert.equal(preempted.gates.laughPreempt, true);
  assert.equal(preempted.enteredLaugh, true);
});

test("烟花尺寸强度同时由 Laugh 笑意与张嘴幅度单调驱动", () => {
  const thresholds = getExpressionThresholds(baseline);
  const threshold = normalizeLaughIntensity(
    thresholds.laughSmileEnter,
    thresholds.laughJawEnter,
    baseline,
  );
  const medium = normalizeLaughIntensity(0.67, 0.47, baseline);
  const strong = normalizeLaughIntensity(0.9, 0.72, baseline);
  const mouthOnly = normalizeLaughIntensity(0.055, 0.72, baseline);

  assert.equal(threshold, 0);
  assert.equal(mouthOnly, 0);
  assert.ok(medium > threshold && medium < strong);
  assert.equal(strong, 1);
});
