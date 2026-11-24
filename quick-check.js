import { DOMAINS, QUESTIONS } from './content.js';
import { assess, scoreAnswer } from './scoring.js';

// The quick check counts reported scenes. It does not estimate frequency,
// severity, or the detailed check's 0–100 score.
export const QUICK_QUESTION_IDS = ['Q02', 'Q05', 'Q12', 'Q13', 'Q20'];
export const QUICK_QUESTIONS = QUICK_QUESTION_IDS.map(id => {
  const question = QUESTIONS.find(item => item.id === id);
  if (!question) throw new Error(`Quick-check question is missing: ${id}`);
  return question;
});

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = value => typeof value === 'string' && value.length > 0;
const CONTEXTS = new Set(['review', 'mixed', 'protective', 'unclear']);

function selectionFor(question, answer) {
  if (!isRecord(question) || !Array.isArray(question.options)) return null;
  if (!isRecord(answer) || !['answered', 'context_hold'].includes(answer.status)) return null;
  if (!Array.isArray(answer.selected) || !answer.selected.length) return null;
  const allowed = new Set(question.options.map(option => option.id));
  if (answer.selected.some(id => !isText(id) || !allowed.has(id))) return null;
  return [...new Set(answer.selected)];
}

export function scoreQuickAnswer(question, answer) {
  if (!isRecord(question) || !isRecord(answer)) return null;
  if (answer.status === 'none') return 0;
  const selected = selectionFor(question, answer);
  if (answer.status !== 'answered' || !selected) return null;
  const concerns = selected.filter(id => question.concernOptions.includes(id));
  if (!concerns.length) return 0;
  if (answer.context != null && !CONTEXTS.has(answer.context)) return null;
  if (answer.context === 'unclear') return null;
  // Historical protective flags cannot manufacture a zero. Q12's concerning
  // options conflict with that exclusion, so its old flags need review.
  if (answer.context === 'protective') {
    return scoreAnswer(question, answer) === 0 ? 0 : null;
  }
  // A quick answer needs no frequency or follow-up context value. Q12's UI
  // presents the scope note and an explicit context_hold choice beforehand.
  return 1;
}

/**
 * Same result structure as assess(), plus quick-mode counts.
 * domains[].valid and reported are each 0 or 1; count is always 1.
 * domains[].score and the overall score remain null intentionally.
 */
export function assessQuick(state) {
  const input = isRecord(state) ? state : {};
  const answers = isRecord(input.answers) ? input.answers : {};
  const items = QUICK_QUESTIONS.map(question => {
    const answer = isRecord(answers[question.id]) ? answers[question.id] : {};
    const selected = selectionFor(question, answer);
    return {
      question,
      answer,
      score: scoreQuickAnswer(question, answer),
      selectedConcernOptions: selected ? selected.filter(id => question.concernOptions.includes(id)) : []
    };
  });

  const domainOrder = new Map(DOMAINS.map((domain, index) => [domain.id, index]));
  const domains = DOMAINS.map(domain => {
    const item = items.find(candidate => candidate.question.domain === domain.id);
    const value = item?.score ?? null;
    return {
      id: domain.id,
      name: domain.name,
      type: domain.type,
      score: null,
      valid: value === null ? 0 : 1,
      count: 1,
      reported: value === 1 ? 1 : 0,
      quickStatus: value === null ? 'unconfirmed' : value === 1 ? 'reported' : 'not_reported'
    };
  });
  const reportedItems = items.filter(item => item.score === 1).sort((left, right) =>
    domainOrder.get(left.question.domain) - domainOrder.get(right.question.domain));
  const challenges = reportedItems.slice(0, 2);
  const priority = reportedItems[0] ?? null;
  const types = domains.filter(domain => domain.reported === 1);
  const totalValid = items.filter(item => item.score !== null).length;

  const reportedIds = new Set(reportedItems.map(item => item.question.id));
  const candidates = [];
  for (const item of items) {
    const selected = selectionFor(item.question, item.answer);
    if (!selected || !isRecord(item.question.strengths)) continue;
    for (const optionId of ['A', 'B']) {
      const text = item.question.strengths[optionId];
      if (!selected.includes(optionId) || !isText(text)) continue;
      candidates.push({ questionId: item.question.id, optionId, text, domain: item.question.domain });
    }
  }
  const relevance = candidate => candidate.questionId === priority?.question.id ? 0
    : reportedIds.has(candidate.questionId) ? 1 : 2;
  candidates.sort((left, right) => relevance(left) - relevance(right)
    || domainOrder.get(left.domain) - domainOrder.get(right.domain)
    || left.optionId.localeCompare(right.optionId, 'en'));
  const strengths = [];
  const usedScenes = new Set();
  for (const candidate of candidates) {
    if (usedScenes.has(candidate.questionId)) continue;
    strengths.push(candidate);
    usedScenes.add(candidate.questionId);
    if (strengths.length === 2) break;
  }

  return {
    mode: 'quick',
    domains,
    score: null,
    totalValid,
    eligible: totalValid > 0,
    types,
    reportedItems,
    reportedCount: reportedItems.length,
    missingCount: QUICK_QUESTIONS.length - totalValid,
    strengths,
    challenges,
    priority,
    safety: assess(input, QUESTIONS, DOMAINS).safety
  };
}
