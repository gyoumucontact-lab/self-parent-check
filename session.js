// Persistence and mode changes are independent of the UI and scoring rules.
// Restoring a record never creates a frequency, context, or safety confirmation.

const MODES = new Set(['quick', 'detailed']);
const QUICK_IDS = ['Q02', 'Q05', 'Q12', 'Q13', 'Q20'];
const DETAILED_IDS = Array.from({ length: 20 }, (_, index) => `Q${String(index + 1).padStart(2, '0')}`);
const SAFETY_IDS = ['S01', 'S02', 'S03', 'S04'];
const ANSWER_STATUSES = new Set(['answered', 'none', 'no_scene', 'unknown', 'skip']);
const OPTION_IDS = new Set(['A', 'B', 'C', 'D']);
const CONTEXTS = new Set(['review', 'protective', 'mixed', 'unclear']);
const CONTEXT_CHECKS = new Set(['need', 'limited', 'respect']);
const SAFETY_STATUSES = new Set(['none', 'recent', 'past', 'other', 'unknown', 'skip']);
const REPORTED_SAFETY_STATUSES = new Set(['recent', 'past', 'other']);
const CURRENT_RISKS = new Set(['yes', 'no', 'unsure']);
const owns = (object, key) => Object.hasOwn(object, key);
const isRecord = value => value !== null && typeof value === 'object'
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

function requireMode(mode) {
  if (!MODES.has(mode)) throw new TypeError('Unknown check mode');
  return mode;
}

function positionFor(value, mode) {
  return Number.isInteger(value) ? Math.max(0, Math.min(mode === 'quick' ? 8 : 23, value)) : 0;
}

function timestamp(value) {
  // App timestamps use ISO 8601 with an explicit time zone. Do not pass arbitrary
  // saved strings through to the UI or replace missing dates with the current time.
  return typeof value === 'string' && value.length <= 40
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value)) ? value : null;
}

function latestAnsweredAt(left, right) {
  const first = timestamp(left);
  const second = timestamp(right);
  if (!first) return second;
  if (!second) return first;
  return Date.parse(first) >= Date.parse(second) ? first : second;
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
}

function emptyDraft() {
  return { answers: {}, safety: {}, position: 0, answeredAt: null, completedAt: null };
}

/** Return a new, unsaved session. Each mode owns its answers and completion date. */
export function freshState(mode = 'quick') {
  requireMode(mode);
  return {
    version: 2,
    mode,
    profile: { age: null },
    answers: {},
    safety: {},
    position: 0,
    saveEnabled: false,
    updatedAt: null,
    answeredAt: null,
    completedAt: null,
    drafts: {}
  };
}

function sanitizeAnswer(answer, id, mode) {
  if (!isRecord(answer)) return null;
  const allowedHold = mode === 'quick' && id === 'Q12' && answer.status === 'context_hold';
  if (!ANSWER_STATUSES.has(answer.status) && !allowedHold) return null;

  const rawSelection = answer.selected ?? [];
  // Removing one invalid option could turn a corrupted concern into a reassuring
  // A/B-only answer. Keep the entire item missing instead.
  if (!Array.isArray(rawSelection) || rawSelection.some(option => !OPTION_IDS.has(option))) return null;
  const selected = [...new Set(rawSelection)];
  if (answer.status === 'none' && selected.length) return null;

  if (answer.status !== 'answered') {
    return { status: answer.status, selected: [], frequency: null, context: null, contextChecks: [] };
  }
  return {
    status: 'answered',
    selected,
    frequency: Number.isInteger(answer.frequency) && answer.frequency >= 0 && answer.frequency <= 4
      ? answer.frequency : null,
    context: CONTEXTS.has(answer.context) ? answer.context : null,
    contextChecks: Array.isArray(answer.contextChecks)
      ? [...new Set(answer.contextChecks.filter(check => CONTEXT_CHECKS.has(check)))] : []
  };
}

function pendingSafetyStatuses(answer, id) {
  if (!isRecord(answer) || !REPORTED_SAFETY_STATUSES.has(answer.status)) return [];
  const candidates = [answer.quickConflictStatus,
    ...(Array.isArray(answer.conflictStatuses) ? answer.conflictStatuses : [])];
  return [...new Set(candidates.filter(status => REPORTED_SAFETY_STATUSES.has(status)
    && status !== answer.status && (status !== 'other' || id === 'S04')))];
}

function keepSafetyConflicts(answer, statuses) {
  if (!statuses.length) return answer;
  // Keep the existing single marker compatible with older saved sessions. The
  // array is needed only when repeated upgrades have left multiple alternatives.
  answer.quickConflictStatus = statuses[0];
  if (statuses.length > 1) answer.conflictStatuses = [...statuses];
  else delete answer.conflictStatuses;
  return answer;
}

function sanitizeSafety(answer, id, mode) {
  if (!isRecord(answer)) return null;
  const currentRisk = CURRENT_RISKS.has(answer.currentRisk) ? answer.currentRisk : null;
  const allowedStatus = SAFETY_STATUSES.has(answer.status) && (answer.status !== 'other' || id === 'S04');
  if (!allowedStatus) {
    // An invalid event label must not erase an explicitly recorded current risk.
    return currentRisk === 'yes' || currentRisk === 'unsure' ? { status: 'unknown', currentRisk } : null;
  }
  // A contradictory "none + yes" remains contradictory: scoring can flag it as
  // unconfirmed and urgent instead of silently changing the risk to "no".
  const restored = { status: answer.status, currentRisk };
  return mode === 'detailed' ? keepSafetyConflicts(restored, pendingSafetyStatuses(answer, id)) : restored;
}

function sanitizeDraft(source, mode) {
  if (!isRecord(source) || !isRecord(source.answers) || !isRecord(source.safety)) return null;
  const result = emptyDraft();
  result.position = positionFor(source.position, mode);
  result.answeredAt = timestamp(source.answeredAt);
  result.completedAt = timestamp(source.completedAt);
  for (const id of mode === 'quick' ? QUICK_IDS : DETAILED_IDS) {
    if (!owns(source.answers, id)) continue;
    const answer = sanitizeAnswer(source.answers[id], id, mode);
    if (answer) result.answers[id] = answer;
  }
  for (const id of SAFETY_IDS) {
    if (!owns(source.safety, id)) continue;
    const answer = sanitizeSafety(source.safety[id], id, mode);
    if (answer) result.safety[id] = answer;
  }
  return result;
}

/**
 * Restore already-parsed, explicitly opted-in saved data, or return null.
 * v1 records belong to the detailed check. Unknown fields are never retained.
 * Bad top-level/draft containers reject the record; bad individual responses
 * remain missing while valid responses can still be recovered.
 */
export function restoreState(parsed) {
  if (!isRecord(parsed) || ![1, 2].includes(parsed.version) || parsed.saveEnabled !== true) return null;
  if (!isRecord(parsed.profile) || !Number.isInteger(parsed.profile.age)
    || parsed.profile.age < 6 || parsed.profile.age > 17) return null;
  const mode = parsed.version === 1 ? 'detailed' : parsed.mode;
  if (!MODES.has(mode)) return null;
  const active = sanitizeDraft(parsed, mode);
  if (!active) return null;

  const restored = freshState(mode);
  restored.profile.age = parsed.profile.age;
  restored.saveEnabled = true;
  restored.updatedAt = timestamp(parsed.updatedAt);
  Object.assign(restored, active);

  if (parsed.version === 2) {
    if (!isRecord(parsed.drafts)) return null;
    for (const draftMode of MODES) {
      if (!owns(parsed.drafts, draftMode)) continue;
      const draft = sanitizeDraft(parsed.drafts[draftMode], draftMode);
      if (!draft) return null;
      restored.drafts[draftMode] = draft;
    }
  }
  return restored;
}

function snapshot(source, mode) {
  return {
    answers: clone(source.answers),
    safety: clone(source.safety),
    position: positionFor(source.position, mode),
    answeredAt: timestamp(source.answeredAt),
    completedAt: source.completedAt ?? null
  };
}

function hasResponse(answers, id) {
  return owns(answers, id) && isRecord(answers[id]) && answers[id].status != null;
}

function recordedUrgentRisk(...answers) {
  const risks = answers.map(answer => answer?.currentRisk);
  if (risks.includes('yes')) return 'yes';
  if (risks.includes('unsure')) return 'unsure';
  return null;
}

function sameSafetyResponse(left, right, id) {
  if (!isRecord(left) || !isRecord(right)) return false;
  return left.status === right.status
    && (left.currentRisk ?? null) === (right.currentRisk ?? null)
    && pendingSafetyStatuses(left, id).sort().join('|') === pendingSafetyStatuses(right, id).sort().join('|');
}

function upgradeSafety(quick, detailed, id) {
  if (!isRecord(detailed) || detailed.status == null) return clone(quick);
  const quickReported = REPORTED_SAFETY_STATUSES.has(quick.status);
  const detailedReported = REPORTED_SAFETY_STATUSES.has(detailed.status);
  const urgentRisk = recordedUrgentRisk(detailed, quick);
  const pending = pendingSafetyStatuses(detailed, id);

  if (pending.length) {
    // Only an explicit response can resolve an existing disagreement. A third
    // report must not overwrite an earlier report about another person's acts.
    if (quickReported && quick.status !== detailed.status && !pending.includes(quick.status)) pending.push(quick.status);
    const preserved = clone(detailed);
    if (quickReported || urgentRisk) preserved.currentRisk = urgentRisk;
    return keepSafetyConflicts(preserved, pending);
  }

  if (quickReported && (!detailedReported || (quick.status === 'recent' && detailed.status === 'past'))) {
    // A new report cannot disappear behind an older "none". Current safety was
    // not asked in quick mode, so reopen that check instead of reusing an old no.
    // Explicit yes/unsure remains visible until the person confirms it again.
    return { status: quick.status, currentRisk: urgentRisk };
  }
  if (quickReported && detailedReported && quick.status !== detailed.status) {
    // Keep both reports rather than guessing who acted or when. The UI must
    // regard this marker as incomplete, explain the two reports, and let the
    // person choose before asking about current safety again.
    return { status: detailed.status, currentRisk: urgentRisk, quickConflictStatus: quick.status };
  }

  const preserved = clone(detailed);
  // Even an unchanged event category is a new quick response. It cannot confirm
  // a previous "no current danger" because quick mode never asks that question.
  if (urgentRisk || (quickReported && detailedReported)) preserved.currentRisk = urgentRisk;
  return preserved;
}

/**
 * Save the outgoing mode and restore the incoming mode without changing input.
 * Only an explicit quick -> detailed upgrade copies overlapping responses.
 * A copied answer is still incomplete if frequency/context/safety was unasked;
 * the UI is responsible for finding the first incomplete detailed question.
 */
export function switchMode(state, mode, { upgrade = false } = {}) {
  requireMode(mode);
  requireMode(state.mode);
  if (state.mode === mode) return state;

  const drafts = clone(state.drafts);
  const outgoing = snapshot(state, state.mode);
  drafts[state.mode] = outgoing;
  const incoming = owns(drafts, mode) ? snapshot(drafts[mode], mode) : emptyDraft();

  if (upgrade === true && state.mode === 'quick' && mode === 'detailed') {
    let transferred = false;
    for (const id of QUICK_IDS) {
      if (!owns(outgoing.answers, id) || hasResponse(incoming.answers, id)) continue;
      const answer = clone(outgoing.answers[id]);
      incoming.answers[id] = answer.status === 'context_hold'
        ? { status: 'unknown', selected: [], frequency: null, context: null, contextChecks: [] }
        : answer;
      if (hasResponse(outgoing.answers, id)) transferred = true;
    }
    for (const id of SAFETY_IDS) {
      if (!owns(outgoing.safety, id)) continue;
      const previous = incoming.safety[id];
      const next = upgradeSafety(outgoing.safety[id], previous, id);
      if (!sameSafetyResponse(previous, next, id)) transferred = true;
      incoming.safety[id] = next;
    }
    // This is the latest known answer update, not a new measurement date.
    // Navigation, saving, and an upgrade that transfers nothing cannot reset it.
    if (transferred) incoming.answeredAt = latestAnsweredAt(incoming.answeredAt, outgoing.answeredAt);
  }

  return {
    version: 2,
    mode,
    profile: clone(state.profile),
    ...incoming,
    saveEnabled: state.saveEnabled,
    updatedAt: state.updatedAt,
    drafts
  };
}
