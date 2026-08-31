export function createCameraStartupGate() {
  let generation = 0;
  let mode = "idle";

  return {
    beginCameraStart() {
      generation += 1;
      mode = "camera";
      return generation;
    },
    invalidate(nextMode = "idle") {
      generation += 1;
      mode = nextMode;
      return generation;
    },
    isCurrent(token) {
      return mode === "camera" && generation === token;
    },
    snapshot() {
      return { generation, mode };
    },
  };
}

export function releaseCameraResources({ stream, landmarker, video }) {
  for (const track of stream?.getTracks?.() ?? []) {
    try {
      track.stop();
    } catch {
      // Resource cleanup must continue even if a browser track is already gone.
    }
  }

  try {
    landmarker?.close?.();
  } catch {
    // MediaPipe close is best-effort during cancellation and page teardown.
  }

  if (
    video &&
    (stream === undefined || stream === null || video.srcObject === stream)
  ) {
    video.srcObject = null;
  }
}

export function deactivateCameraRuntime({
  gate,
  mode = "idle",
  stream,
  landmarker,
  video,
  resetRuntime,
}) {
  gate.invalidate(mode);
  releaseCameraResources({ stream, landmarker, video });
  resetRuntime?.();
}

export function finalizeCameraStartup({
  gate,
  token,
  stream,
  landmarker,
  video,
  onCommit,
}) {
  if (!gate.isCurrent(token)) {
    releaseCameraResources({ stream, landmarker, video });
    return false;
  }

  onCommit();
  return true;
}

export function listenForPageHidden(documentLike, onHidden) {
  const handleVisibility = () => {
    if (
      documentLike.hidden === true ||
      documentLike.visibilityState === "hidden"
    ) {
      onHidden();
    }
  };

  documentLike.addEventListener("visibilitychange", handleVisibility);
  return () =>
    documentLike.removeEventListener("visibilitychange", handleVisibility);
}

export function advanceNeutralCalibration(
  baseline,
  sample,
  { hasFace = true, requiredSamples = 18 } = {},
) {
  const target = Math.max(1, requiredSamples);
  const wasComplete = baseline.samples >= target;

  if (!hasFace || !sample || wasComplete) {
    return {
      accepted: false,
      complete: wasComplete,
      canClassify: wasComplete,
      progress: Math.min(100, Math.round((baseline.samples / target) * 100)),
    };
  }

  const nextSamples = baseline.samples + 1;
  baseline.smile =
    (baseline.smile * baseline.samples + sample.smile) / nextSamples;
  baseline.jaw =
    (baseline.jaw * baseline.samples + sample.jaw) / nextSamples;
  baseline.cheek =
    (baseline.cheek * baseline.samples + sample.cheek) / nextSamples;
  baseline.samples = nextSamples;

  return {
    accepted: true,
    complete: baseline.samples >= target,
    // The sample that completes the baseline is still a calibration frame.
    canClassify: false,
    progress: Math.min(100, Math.round((baseline.samples / target) * 100)),
  };
}

export function neutralCalibrationPrompt(calibration, messages) {
  return calibration.complete
    ? messages.ready
    : messages.calibrating(calibration.progress);
}
