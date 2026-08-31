export const EXPRESSION_CONFIG = Object.freeze({
  calibrationSamples: 18,
  smileConfirmMs: 0,
  laughConfirmMs: 0,
  exitConfirmMs: 320,
  laughCooldownMs: 0,
  smileResumeDelayMs: 0,
});

export function createExpressionTracker() {
  return {
    candidate: "neutral",
    candidateSince: 0,
    candidateDurationMs: 0,
  };
}

export function getExpressionThresholds(baseline) {
  const smileEnter = Math.max(0.06, baseline.smile + 0.018);
  const smileExit = Math.max(0.045, baseline.smile + 0.008);
  return {
    smileEnter,
    smileExit,
    smileJawEnterMax: Math.max(0.1, baseline.jaw + 0.045),
    smileJawExitMax: Math.max(0.125, baseline.jaw + 0.07),
    laughSmileEnter: smileEnter,
    laughSmileExit: smileExit,
    laughJawEnter: Math.max(0.14, baseline.jaw + 0.075),
    laughJawExit: Math.max(0.11, baseline.jaw + 0.055),
  };
}

export function combineSmileSides(left, right) {
  const average = (left + right) * 0.5;
  return Math.min(left, right) * 0.35 + average * 0.65;
}

export function normalizeSmileIntensity(smile, baseline) {
  const threshold = getExpressionThresholds(baseline).smileEnter;
  return Math.max(
    0,
    Math.min(1, (smile - threshold) / Math.max(0.08, 0.78 - threshold)),
  );
}

export function normalizeLaughIntensity(laughSmile, jaw, baseline) {
  const thresholds = getExpressionThresholds(baseline);
  const smileAmount = Math.max(
    0,
    Math.min(
      1,
      (laughSmile - thresholds.laughSmileEnter) /
        Math.max(0.12, 0.9 - thresholds.laughSmileEnter),
    ),
  );
  const jawAmount = Math.max(
    0,
    Math.min(
      1,
      (jaw - thresholds.laughJawEnter) /
        Math.max(0.12, 0.72 - thresholds.laughJawEnter),
    ),
  );
  return Math.sqrt(smileAmount * jawAmount);
}

export function isLaughPreemptCandidate(laughSmile, jaw, baseline) {
  const thresholds = getExpressionThresholds(baseline);
  return (
    laughSmile >= thresholds.laughSmileEnter &&
    jaw >= thresholds.laughJawEnter
  );
}

export function combineLaughSmile(smile, cheekSquint, baselineCheek = 0) {
  return Math.max(
    0,
    Math.min(1, smile + Math.max(0, cheekSquint - baselineCheek) * 0.12),
  );
}

function confirmationDuration(current, candidate) {
  if (candidate === current) return 0;
  if (candidate === "laugh") return EXPRESSION_CONFIG.laughConfirmMs;
  if (candidate === "smile") return EXPRESSION_CONFIG.smileConfirmMs;
  return EXPRESSION_CONFIG.exitConfirmMs;
}

/**
 * Advances the single mutually-exclusive expression state. Raw evidence first
 * selects one candidate with LAUGH > SMILE > NEUTRAL priority; elapsed time,
 * rather than detector frame count, promotes that candidate to stable state.
 */
export function advanceExpressionState({
  current,
  smile,
  laughSmile = smile,
  jaw,
  baseline,
  tracker,
  canClassify,
  now,
  smileResumeAt,
  laughCooldownUntil = -Infinity,
  laughPreempt = false,
}) {
  const thresholds = getExpressionThresholds(baseline);
  if (!canClassify) {
    return {
      next: "neutral",
      enteredLaugh: false,
      exitedLaugh: current === "laugh",
      candidate: "neutral",
      candidateDurationMs: 0,
      tracker: createExpressionTracker(),
      thresholds,
      gates: {
        laughEvidence: false,
        laughContinuous: false,
        laughAllowed: false,
        laughPreempt: false,
        smileEvidence: false,
        cooldownBlocked: false,
      },
    };
  }

  const laughKeep =
    laughSmile >= thresholds.laughSmileExit &&
    jaw >= thresholds.laughJawExit;
  const laughEvidence =
    laughSmile >= thresholds.laughSmileEnter &&
    jaw >= thresholds.laughJawEnter;
  const laughAllowed = laughEvidence && now >= laughCooldownUntil;
  const smileThreshold =
    current === "smile" ? thresholds.smileExit : thresholds.smileEnter;
  const smileJawMax =
    current === "smile"
      ? thresholds.smileJawExitMax
      : thresholds.smileJawEnterMax;
  const smileEvidence =
    !laughEvidence &&
    !laughPreempt &&
    smile >= smileThreshold &&
    jaw <= smileJawMax &&
    now >= smileResumeAt;

  let candidate = "neutral";
  if (current === "laugh") {
    candidate = laughKeep ? "laugh" : "neutral";
  } else if (laughAllowed) {
    candidate = "laugh";
  } else if (smileEvidence) {
    candidate = "smile";
  }

  let candidateSince =
    tracker.candidate === candidate ? tracker.candidateSince : now;
  let candidateDurationMs = Math.max(0, now - candidateSince);
  let next = current;

  if (candidate === current) {
    candidateSince = now;
    candidateDurationMs = 0;
  } else if (
    candidateDurationMs >= confirmationDuration(current, candidate)
  ) {
    next = candidate;
    candidateSince = now;
    candidateDurationMs = 0;
  }

  return {
    next,
    enteredLaugh: current !== "laugh" && next === "laugh",
    exitedLaugh: current === "laugh" && next !== "laugh",
    candidate,
    candidateDurationMs,
    tracker: {
      candidate,
      candidateSince,
      candidateDurationMs,
    },
    thresholds,
    gates: {
      laughEvidence,
      laughContinuous: current === "laugh" ? laughKeep : laughEvidence,
      laughAllowed,
      laughPreempt,
      smileEvidence,
      cooldownBlocked: laughEvidence && !laughAllowed,
    },
  };
}
