// Independent reflection rules; these scores are not a validated diagnostic scale.
// Keep unconfirmed responses missing, and keep safety reports outside the average.

const SAFETY_IDS = ['S01', 'S02', 'S03', 'S04'];
const PROTECTIVE_IDS = new Set(['Q01', 'Q09', 'Q11']);
const CONTEXTUAL_IDS = new Set(['Q01', 'Q09', 'Q10', 'Q11', 'Q12', 'Q16']);
const PROTECTIVE_CHECKS = ['need', 'limited', 'respect'];
const CONTEXTS = new Set(['review', 'protective', 'mixed', 'unclear']);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = value => typeof value === 'string' && value.length > 0;

function selectionFor(question, answer) {
  if (!isRecord(question) || !isRecord(answer) || !Array.isArray(question.options)) return null;
  if (answer.status !== 'answered' || !Array.isArray(answer.selected) || !answer.selected.length) return null;
  const allowed = new Set(question.options.filter(isRecord).map(option => option.id).filter(isText));
  if (answer.selected.some(id => !isText(id) || !allowed.has(id))) return null;
  return [...new Set(answer.selected)];
}

function concernsFor(question, selection) {
  const concerns = new Set(Array.isArray(question.concernOptions) ? question.concernOptions : ['C', 'D']);
  return selection.filter(id => concerns.has(id));
}

function isConfirmedProtection(question, answer, concerns) {
  return PROTECTIVE_IDS.has(question.id)
    && concerns.length === 1 && concerns[0] === 'C'
    && Array.isArray(answer.contextChecks)
    && PROTECTIVE_CHECKS.every(check => answer.contextChecks.includes(check));
}

/**
 * Return an item score of 0–4, or null for missing / unresolved information.
 * frequency is a category, not an event count. Multiple selected concerns in one
 * scene share this category; they are never added to one another.
 */
export function scoreAnswer(question, answer) {
  if (!isRecord(question) || !isRecord(answer)) return null;
  if (answer.status === 'none') return 0;
  const selected = selectionFor(question, answer);
  if (!selected) return null;
  const concerns = concernsFor(question, selected);
  if (!concerns.length) return 0;
  // Results may be opened before the question's Next button is validated.
  // These scenes require an explicit context choice even if days were entered.
  if (CONTEXTUAL_IDS.has(question.id) && answer.context == null) return null;
  if (answer.context != null && !CONTEXTS.has(answer.context)) return null;
  if (answer.context === 'unclear') return null;
  if (answer.context === 'protective') {
    return isConfirmedProtection(question, answer, concerns) ? 0 : null;
  }
  const frequency = answer.frequency;
  return Number.isInteger(frequency) && frequency >= 1 && frequency <= 4 ? frequency : null;
}

function assessSafety(safetyInput) {
  const safety = isRecord(safetyInput) ? safetyInput : {};
  const result = { recent: [], past: [], other: [], unconfirmed: [], urgent: [] };
  for (const id of SAFETY_IDS) {
    const entry = isRecord(safety[id]) ? safety[id] : {};
    const status = entry.status;
    const risk = entry.currentRisk;
    const knownStatus = ['none', 'recent', 'past', 'other'].includes(status);
    if (status === 'recent' || status === 'past' || status === 'other') result[status].push(id);
    // Other people's violence can require urgent protection without becoming
    // a report of an act committed by this respondent.
    if (risk === 'yes' || risk === 'unsure') result.urgent.push(id);
    const needsCurrentCheck = ['recent', 'past', 'other'].includes(status) && risk !== 'yes' && risk !== 'no';
    const invalidRisk = risk != null && !['yes', 'no', 'unsure'].includes(risk);
    const contradictsNone = status === 'none' && (risk === 'yes' || risk === 'unsure');
    if (!knownStatus || needsCurrentCheck || invalidRisk || contradictsNone) result.unconfirmed.push(id);
  }
  return result;
}

function uniqueRecords(records, predicate) {
  const seen = new Set();
  if (!Array.isArray(records)) return [];
  return records.filter(record => {
    if (!isRecord(record) || !isText(record.id) || seen.has(record.id) || !predicate(record)) return false;
    seen.add(record.id);
    return true;
  });
}

/**
 * Domain fields: valid = answered item count, count = configured item count,
 * reported = item count with a confirmed concern score above zero.
 * Raw domain scores determine ties; only the overall display score is rounded.
 * No input object is changed by this function.
 */
export function assess(state, questions, domains) {
  const input = isRecord(state) ? state : {};
  const answers = isRecord(input.answers) ? input.answers : {};
  const domainDefinitions = uniqueRecords(domains, domain => isText(domain.name) && isText(domain.type));
  const domainIds = new Set(domainDefinitions.map(domain => domain.id));
  const questionDefinitions = uniqueRecords(questions, question =>
    domainIds.has(question.domain) && Array.isArray(question.options) && question.options.length > 0);

  const items = questionDefinitions.map(question => {
    const answer = isRecord(answers[question.id]) ? answers[question.id] : {};
    const selected = selectionFor(question, answer);
    return {
      question,
      answer,
      score: scoreAnswer(question, answer),
      selectedConcernOptions: selected ? concernsFor(question, selected) : []
    };
  });

  const domainResults = domainDefinitions.map(domain => {
    const group = items.filter(item => item.question.domain === domain.id);
    const validItems = group.filter(item => item.score !== null);
    const canCalculate = group.length === 4 && validItems.length >= 3;
    return {
      id: domain.id,
      name: domain.name,
      type: domain.type,
      score: canCalculate ? 25 * validItems.reduce((sum, item) => sum + item.score, 0) / validItems.length : null,
      valid: validItems.length,
      count: group.length,
      reported: group.filter(item => item.score > 0).length
    };
  });

  const totalValid = items.filter(item => item.score !== null).length;
  const definitionIsComplete = domainResults.length === 5 && questionDefinitions.length === 20
    && domainResults.every(domain => domain.count === 4)
    && Array.isArray(questions) && questions.length === 20
    && Array.isArray(domains) && domains.length === 5;
  const eligible = definitionIsComplete && totalValid >= 16 && domainResults.every(domain => domain.score !== null);
  const score = eligible ? Math.round(domainResults.reduce((sum, domain) => sum + domain.score, 0) / 5) : null;
  const highest = eligible ? Math.max(...domainResults.map(domain => domain.score)) : null;
  const types = eligible && highest > 0
    ? domainResults.filter(domain => Math.abs(domain.score - highest) < 1e-9)
    : [];

  const domainScores = new Map(domainResults.map(domain => [domain.id, domain.score ?? -1]));
  const byId = (left, right) => left.localeCompare(right, 'en');
  const reportedItems = items.filter(item => item.score > 0).sort((left, right) =>
    right.score - left.score
    || domainScores.get(right.question.domain) - domainScores.get(left.question.domain)
    || byId(left.question.id, right.question.id));
  const challenges = reportedItems.slice(0, 2);
  const priority = reportedItems[0] ?? null;

  const challengeIds = new Set(challenges.map(item => item.question.id));
  const typeIds = new Set(types.map(domain => domain.id));
  const strengthCandidates = [];
  for (const item of items) {
    const selected = selectionFor(item.question, item.answer);
    if (!selected || !isRecord(item.question.strengths)) continue;
    // Fixed option order makes A+B deterministic; at most one will be used for
    // this scene, and the text comes only from an actually selected option.
    for (const optionId of ['A', 'B']) {
      const text = item.question.strengths[optionId];
      if (!selected.includes(optionId) || !isText(text)) continue;
      strengthCandidates.push({ questionId: item.question.id, optionId, text, domain: item.question.domain });
    }
  }
  function strengthRelevance(candidate) {
    if (candidate.questionId === priority?.question.id) return 0;
    if (challengeIds.has(candidate.questionId)) return 1;
    if (candidate.domain === priority?.question.domain) return 2;
    if (typeIds.has(candidate.domain)) return 3;
    return 4;
  }
  strengthCandidates.sort((left, right) => strengthRelevance(left) - strengthRelevance(right)
    || domainScores.get(right.domain) - domainScores.get(left.domain)
    || byId(left.questionId, right.questionId)
    || byId(left.optionId, right.optionId));
  const strengths = [];
  const usedScenes = new Set();
  for (const candidate of strengthCandidates) {
    if (usedScenes.has(candidate.questionId)) continue;
    strengths.push(candidate);
    usedScenes.add(candidate.questionId);
    if (strengths.length === 2) break;
  }

  return {
    domains: domainResults,
    score,
    totalValid,
    eligible,
    types,
    reportedItems,
    strengths,
    challenges,
    priority,
    safety: assessSafety(input.safety)
  };
}
