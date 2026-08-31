import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceNeutralCalibration,
  createCameraStartupGate,
  deactivateCameraRuntime,
  finalizeCameraStartup,
  listenForPageHidden,
  neutralCalibrationPrompt,
} from "../app/camera-runtime.mjs";

function createDeferred() {
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function createFakeDocument() {
  const listeners = new Set();
  return {
    hidden: false,
    visibilityState: "visible",
    addEventListener(type, listener) {
      if (type === "visibilitychange") listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === "visibilitychange") listeners.delete(listener);
    },
    dispatchVisibility() {
      for (const listener of listeners) listener();
    },
    listenerCount() {
      return listeners.size;
    },
  };
}

test("页面进入 hidden 后释放摄像头和模型并保持安全空闲状态", () => {
  const gate = createCameraStartupGate();
  const startupToken = gate.beginCameraStart();
  let stoppedTracks = 0;
  let closedLandmarkers = 0;
  const automaticRestarts = 0;
  const stream = {
    getTracks: () => [{ stop: () => (stoppedTracks += 1) }],
  };
  const landmarker = { close: () => (closedLandmarkers += 1) };
  const video = { srcObject: stream };
  const runtime = {
    expression: "laugh",
    candidate: "laugh",
    particles: 120,
    collisions: 7,
    mode: "live",
  };
  const documentLike = createFakeDocument();
  const removeListener = listenForPageHidden(documentLike, () => {
    deactivateCameraRuntime({
      gate,
      mode: "idle",
      stream,
      landmarker,
      video,
      resetRuntime: () => {
        runtime.expression = "neutral";
        runtime.candidate = "neutral";
        runtime.particles = 0;
        runtime.collisions = 0;
        runtime.mode = "idle";
      },
    });
  });

  documentLike.dispatchVisibility();
  assert.equal(stoppedTracks, 0);

  documentLike.hidden = true;
  documentLike.visibilityState = "hidden";
  documentLike.dispatchVisibility();
  assert.equal(stoppedTracks, 1);
  assert.equal(closedLandmarkers, 1);
  assert.equal(video.srcObject, null);
  assert.deepEqual(runtime, {
    expression: "neutral",
    candidate: "neutral",
    particles: 0,
    collisions: 0,
    mode: "idle",
  });
  assert.equal(gate.isCurrent(startupToken), false);

  documentLike.hidden = false;
  documentLike.visibilityState = "visible";
  documentLike.dispatchVisibility();
  assert.equal(automaticRestarts, 0);
  assert.equal(gate.snapshot().mode, "idle");

  removeListener();
  assert.equal(documentLike.listenerCount(), 0);
});

test("进入模拟模式后延迟完成的摄像头任务不能覆盖 demo", async () => {
  const gate = createCameraStartupGate();
  const token = gate.beginCameraStart();
  const streamDeferred = createDeferred();
  const modelDeferred = createDeferred();
  let stoppedTracks = 0;
  let closedLandmarkers = 0;
  let committedLive = 0;
  const stream = {
    getTracks: () => [{ stop: () => (stoppedTracks += 1) }],
  };
  const landmarker = { close: () => (closedLandmarkers += 1) };
  const video = { srcObject: null };
  const runtime = { mode: "loading" };

  const delayedStart = (async () => {
    const delayedStream = await streamDeferred.promise;
    if (!gate.isCurrent(token)) return false;
    video.srcObject = delayedStream;
    const delayedLandmarker = await modelDeferred.promise;
    return finalizeCameraStartup({
      gate,
      token,
      stream: delayedStream,
      landmarker: delayedLandmarker,
      video,
      onCommit: () => {
        committedLive += 1;
        runtime.mode = "live";
      },
    });
  })();

  streamDeferred.resolve(stream);
  await Promise.resolve();
  deactivateCameraRuntime({
    gate,
    mode: "demo",
    stream,
    landmarker: null,
    video,
    resetRuntime: () => {
      runtime.mode = "demo";
    },
  });
  modelDeferred.resolve(landmarker);

  assert.equal(await delayedStart, false);
  assert.equal(runtime.mode, "demo");
  assert.equal(committedLive, 0);
  assert.ok(stoppedTracks >= 1);
  assert.equal(closedLandmarkers, 1);
  assert.equal(video.srcObject, null);
  assert.equal(gate.snapshot().mode, "demo");
});

test("18个有效中性样本完成前显示校准提示且丢脸帧不计数", () => {
  const baseline = { smile: 0, jaw: 0, cheek: 0, samples: 0 };
  const messages = {
    calibrating: (progress) => `请保持自然表情，正在校准 · ${progress}%`,
    ready: "请尽情的绽放你的笑容吧",
  };

  const lostFrame = advanceNeutralCalibration(baseline, null, {
    hasFace: false,
    requiredSamples: 18,
  });
  assert.equal(lostFrame.accepted, false);
  assert.equal(baseline.samples, 0);

  for (let index = 1; index <= 17; index += 1) {
    const calibration = advanceNeutralCalibration(
      baseline,
      { smile: 0.04, jaw: 0.03, cheek: 0.04 },
      { requiredSamples: 18 },
    );
    assert.equal(calibration.canClassify, false);
    assert.match(neutralCalibrationPrompt(calibration, messages), /正在校准/);
    assert.notEqual(
      neutralCalibrationPrompt(calibration, messages),
      messages.ready,
    );
  }

  const finalCalibrationFrame = advanceNeutralCalibration(
    baseline,
    { smile: 0.04, jaw: 0.03, cheek: 0.04 },
    { requiredSamples: 18 },
  );
  assert.equal(baseline.samples, 18);
  assert.equal(finalCalibrationFrame.complete, true);
  assert.equal(finalCalibrationFrame.canClassify, false);
  assert.equal(
    neutralCalibrationPrompt(finalCalibrationFrame, messages),
    messages.ready,
  );

  const firstClassifiableFrame = advanceNeutralCalibration(
    baseline,
    { smile: 0.8, jaw: 0.6, cheek: 0.5 },
    { requiredSamples: 18 },
  );
  assert.equal(firstClassifiableFrame.accepted, false);
  assert.equal(firstClassifiableFrame.canClassify, true);
  assert.equal(baseline.samples, 18);
});
