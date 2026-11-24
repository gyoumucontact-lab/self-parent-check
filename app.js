import { DOMAINS, QUESTIONS, SAFETY_QUESTIONS, REFERENCES, META } from './content.js';
import { assess, scoreAnswer } from './scoring.js';
import { QUICK_QUESTIONS, assessQuick, scoreQuickAnswer } from './quick-check.js';
import { freshState, restoreState, switchMode } from './session.js';

const KEY = 'parent-care-check:answers:v1';
const main = document.getElementById('main');
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list = value => Array.isArray(value) ? value : [];
const referenceMap = Object.fromEntries(REFERENCES.map(r => [r.id, r]));
const domainMap = Object.fromEntries(DOMAINS.map(d => [d.id, d]));
const allQuestions = [...QUESTIONS, ...SAFETY_QUESTIONS];
const days = ['0日', '1日', '2〜3日', '4〜7日', '8日以上'];
const statusLabels = { none:'この場面はあったが、どの対応もしていない', no_scene:'この場面はなかった', unknown:'思い出せない', skip:'今回は回答しない', context_hold:'状況の判断を保留する' };
const protectiveIds = new Set(['Q01','Q09','Q11']);
const contextualIds = new Set(['Q01','Q09','Q10','Q11','Q12','Q16']);
let state = freshState();
let screen = 'home';
let previousScreen = 'home';
let formError = '';
let toastTimer;
let dialogLastFocus = null;

function isQuick(data=state) { return data.mode==='quick'; }
function activeQuestions(data=state) { return isQuick(data)?[...QUICK_QUESTIONS,...SAFETY_QUESTIONS]:allQuestions; }
function dailyQuestions(data=state) { return isQuick(data)?QUICK_QUESTIONS:QUESTIONS; }
function modeName(data=state) { return isQuick(data)?'手軽にチェック':'詳しくチェック'; }
function cleanText(text) {
  return String(text || '')
    .replace(/C01で分ける/g,'状況を確認して区別する')
    .replace(/S03へ/g,'安全確認の「閉じ込め・置き去り」へ')
    .replace(/C\d{2}/g,'状況の確認')
    .replace(/R\d{2}/g, id => referenceMap[id]?.author || '参照文献');
}
function paragraph(text, cls='') { return '<p'+(cls?' class="'+cls+'"':'')+'>'+esc(cleanText(text))+'</p>'; }
function nl(text) { return esc(cleanText(text)).replace(/\n/g,'<br>'); }
function icon(name, size=24) {
  const paths = {
    leaf:'<path d="M20 4c-8-1-15 3-15 9a6 6 0 0 0 6 6c6 0 10-7 9-15Z"/><path d="m4 21 10-10"/>',
    heart:'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
    book:'<path d="M12 5v16M3 3c4-1 7 0 9 2 2-2 5-3 9-2v16c-4-1-7 0-9 2-2-2-5-3-9-2Z"/>',
    check:'<path d="m5 12 4 4L19 6"/>',
    shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
    chat:'<path d="M20 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 0 1 18 0Z"/><path d="M7 9h8M7 13h5"/>',
    sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
    print:'<path d="M6 9V3h12v6M6 17H3V9h18v8h-3M6 14h12v7H6Z"/>',
    save:'<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
    lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>'
  };
  return '<svg width="'+size+'" height="'+size+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(paths[name] || paths.leaf)+'</svg>';
}
function button(label, action, style='primary', extra='') {
  return '<button type="button" class="button '+style+'" data-action="'+action+'" '+extra+'>'+label+'</button>';
}
function restore() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const restored = restoreState(JSON.parse(raw));
    if(restored) state=restored;
  } catch { /* Local storage may be unavailable; the session still works. */ }
}
restore();
function persist() {
  state.updatedAt = new Date().toISOString();
  if (!state.saveEnabled) return;
  try { localStorage.setItem(KEY,JSON.stringify(state)); }
  catch { state.saveEnabled=false; toast('このブラウザーでは保存できません。回答はこの画面を開いている間だけ保持します。'); }
}
function clearStorage() { try { localStorage.removeItem(KEY); } catch {} }
function toast(text) {
  clearTimeout(toastTimer);
  $('toast').textContent=text; $('toast').hidden=false;
  toastTimer=setTimeout(()=>{$('toast').hidden=true;},4500);
}
function navigate(next, top=true) {
  if(next!=='support'&&next!=='sources'&&next!=='about'&&next!=='privacy') previousScreen=next;
  screen=next; formError='';
  render({top});
}
function render({top=false,focusId=null}={}) {
  const renderers = {home:renderHome, setup:renderSetup, quiz:renderQuiz, results:renderResults, sources:renderSources, about:renderAbout, privacy:renderPrivacy, support:renderSupport};
  main.innerHTML = (renderers[screen] || renderHome)();
  document.body.dataset.view=screen;
  const viewTitle={setup:'はじめる前に',quiz:'質問に回答',results:'チェック結果',sources:'根拠文献',about:'このチェックについて',privacy:'回答と保存について',support:'相談先'}[screen];
  document.title=(viewTitle?viewTitle+'｜':'')+'セルフ毒親チェック｜子と親の心理学';
  if(top){window.scrollTo({top:0,behavior:'instant'});main.focus({preventScroll:true});}
  if(focusId) $(focusId)?.focus({preventScroll:true});
}
function answeredCount() { return activeQuestions().filter(q=>questionValid(q)).length; }
function checkComplete() { return activeQuestions().every(q=>questionValid(q)); }
function hasResponses() { return Object.keys(state.answers).length>0 || Object.keys(state.safety).length>0; }
function hasAnyResponses() { return hasResponses() || Object.values(state.drafts).some(d=>Object.keys(d.answers||{}).length || Object.keys(d.safety||{}).length); }
function recordResponseChange() { state.completedAt=null; state.answeredAt=new Date().toISOString(); }
function answerDateText(data) { return data.answeredAt?'最終回答の更新：'+new Date(data.answeredAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})+'（日本時間）':'回答日時の記録がありません。保存済みの回答を使う場合は、対象の期間を確認してください。'; }
function safetyConflicts(answer) { return [...new Set([...list(answer?.conflictStatuses),answer?.quickConflictStatus].filter(s=>['recent','past','other'].includes(s)&&s!==answer?.status))]; }
function safetyReportsText(answer) { return [answer?.status,...safetyConflicts(answer)].map(s=>safetyStatusLabel(s)).join('／'); }
function currentRiskLabel(answer) { return {yes:'現在の危険・けが、または再発のおそれの報告あり',no:'回答時点ではその状況ではない',unsure:'現在の安全は判断が難しい'}[answer?.currentRisk]||'現在の安全は未確認'; }
function isSafety(q) { return q.id.startsWith('S'); }
function concern(q,a) { return a?.status==='answered' && list(a.selected).some(v=>q.concernOptions.includes(v)); }
function canProtect(q,a) { return protectiveIds.has(q.id)&&list(a?.selected).includes('C')&&!list(a?.selected).includes('D'); }
function pageHeading(label,title,description='') { return '<div class="page-title"><span class="eyebrow">'+label+'</span><h1>'+title+'</h1>'+(description?paragraph(description):'')+'</div>'; }
function backToWork() {
  return hasResponses()?button('回答に戻る','resume','secondary'):button('チェックをはじめる','start','primary');
}
function renderHome() {
  const resume=hasResponses();
  return '<div class="container view home-view"><section class="hero home-illustrated">'+
    '<div class="hero-copy"><span class="eyebrow"><span class="eyebrow-line"></span>子育ての振り返りツール</span>'+
    '<h1 class="hero-title"><span class="hero-name">セルフ<wbr>毒親チェック</span><span class="hero-tagline">いまの接し方と、<br>これからの一歩。</span></h1>'+
    '<p class="hero-lead">自分では気づきにくい、子どもへの接し方の問題や課題に気づくためのツールです。日常の場面での自分の言動を振り返り、できている強みと見直したい関わり方を確かめ、これからの接し方を考えます。</p>'+
    '<div class="hero-actions">'+button(resume?(checkComplete()?'チェック結果を見る':'続きから回答する'):'チェック方法を選ぶ',resume?(checkComplete()?'results':'resume'):'choose-mode')+
    button('結果のサンプルを見る','sample','secondary')+'</div>'+
    '<div class="hero-note"><span>'+icon('check',17)+'6〜17歳の子どもの保護者向け</span><span>'+icon('lock',17)+'回答は端末内で処理</span></div>'+
    (resume?'<div class="resume-note">'+modeName()+'：'+answeredCount()+' / '+activeQuestions().length+'問の回答が完了しています。'+(state.saveEnabled?'途中保存を有効にしています。':'この画面を閉じると回答は消えます。')+'</div>':'')+
    '</div><div class="hero-art"><figure class="hero-illustration-frame">'+
    '<img class="hero-illustration" src="./assets/parent-child-style01.png" width="1672" height="941" alt="黄緑色のソファに座る親子。子どもが話し、母親が穏やかな表情で耳を傾けている手描きのイラスト。" fetchpriority="high" decoding="async">'+
    '<figcaption>話を聞くことから、親子の一歩を。</figcaption></figure></div></section>'+
    '<section class="check-modes" id="check-modes" aria-labelledby="mode-title"><div class="section-heading"><div><span class="eyebrow">今の余裕に合わせて</span><h2 id="mode-title" tabindex="-1">2つのチェックから選べます。</h2></div><p>どちらも、強み・課題・次の接し方まで。</p></div>'+
    '<div class="mode-grid"><article class="mode-card quick"><span class="mode-kicker">まずは気軽に</span><h3>手軽にチェック</h3><p class="mode-count">9<small>問・追加質問なし</small></p><p>5つの代表的な場面と、安全に関わる4問。実際にした対応を選ぶだけです。</p><ul><li>日数の入力はありません</li><li>気になる傾向と、次の一歩を確認</li><li>結果から詳しい版へ進めます</li></ul>'+button('手軽にチェック','choose-check','primary','data-mode="quick"')+'</article>'+
    '<article class="mode-card"><span class="mode-kicker">じっくり振り返る</span><h3>詳しくチェック</h3><p class="mode-count">24<small>問＋状況・日数の確認</small></p><p>これまでの詳しい版です。日常の20問と安全の4問から、関わり方を細かく振り返ります。</p><ul><li>必要な場合に、日数や状況を追加確認</li><li>5領域の傾向と振り返りスコアを表示</li><li>途中保存して、続きから再開できます</li></ul>'+button('詳しくチェック','choose-check','secondary','data-mode="detailed"')+'</article></div></section>'+
    '<section class="home-bottom" aria-labelledby="home-guide-title"><div class="section-heading"><div><span class="eyebrow">このチェックでできること</span><h2 id="home-guide-title">回答を、次の接し方につなげる。</h2></div><p>結果とともに、具体的な言葉や行動をお返しします。</p></div>'+
    '<div class="feature-grid"><article class="feature-card"><span class="feature-icon">'+icon('chat',28)+'</span><h3>ふだんの場面から</h3><p>子どもの失敗、成績、反抗や相談。直近30日に実際にした対応を選びます。</p></article>'+
    '<article class="feature-card"><span class="feature-icon">'+icon('shield',28)+'</span><h3>状況の違いも大切に</h3><p>危険を止めるための声や、発達に応じた援助など、必要な対応を確認します。</p></article>'+
    '<article class="feature-card"><span class="feature-icon">'+icon('book',28)+'</span><h3>根拠まで確かめられる</h3><p>研究の内容、対象年齢、分かっていないことも、文献と一緒に読めます。</p></article></div></section>'+
    '<div class="home-disclaimer">'+icon('info',20)+'<p>「毒親度」は独自の振り返り指標です。医学的診断や、親の人格・子どもの将来を判定するものではありません。</p></div></div>';
}
function renderSetup() {
  const age=state.profile.age,quick=isQuick(),count=activeQuestions().length;
  return '<div class="container narrow view">'+pageHeading('はじめる前に','ひとりの子どもを<br>思い浮かべてください。','直近30日の、あなた自身の接し方を振り返ります。名前や連絡先の入力はありません。')+
    '<section class="form-card"><fieldset class="mode-switch"><legend class="field-label">チェック方法</legend>'+[['quick','手軽にチェック','9問・追加質問なし'],['detailed','詳しくチェック','24問＋状況・日数の確認']].map(([id,title,description])=>'<label class="'+(state.mode===id?'selected':'')+'"><input type="radio" name="check-mode" value="'+id+'" '+(state.mode===id?'checked':'')+'><span><strong>'+title+'</strong><small>'+description+'</small></span></label>').join('')+'</fieldset>'+
    '<div class="field"><label class="field-label" for="child-age">子どもの年齢 <span class="required-label">必須</span></label><select id="child-age" name="child-age"><option value="">年齢を選んでください</option>'+
    Array.from({length:12},(_,i)=>i+6).map(n=>'<option value="'+n+'" '+(age===n?'selected':'')+'>'+n+'歳</option>').join('')+'</select><p class="small-text muted">現在の質問は6〜17歳向けです。発達や必要な支援は、それぞれの場面で確認します。</p></div>'+
    '<div class="setup-guide"><h2>'+modeName()+'の答え方</h2><ul><li>実際にした対応を、複数選べます。</li><li>1回だけした対応も含めて選んでください。</li><li>場面がない・思い出せない質問は、そのまま選べます。</li><li>'+(quick?'回答後の追加質問はありません。詳しい版には結果画面から進めます。':'見直したい対応を選ぶと、必要に応じて日数や状況も確認します。')+'</li></ul></div>'+
    '<label class="inline-check storage-choice"><input type="checkbox" id="save-setup" '+(state.saveEnabled?'checked':'')+'><span><b>この端末に回答を保存する</b><small>オンにすると、ページを閉じても途中から再開できます。共有端末ではオフにしてください。</small></span></label>'+
    (formError?'<p class="field-error" role="alert">'+esc(formError)+'</p>':'')+
    '<div class="button-row">'+button(count+'問のチェックをはじめる','begin','primary')+button('戻る','home','ghost')+'</div></section>'+
    '<p class="small-text muted">'+(quick?'日常の5問と安全確認の4問です。手軽版の毒親度は、見直したい対応が報告された場面の件数で表示します。':'日常の20問と安全確認の4問です。日数や状況を踏まえて、振り返りスコアを表示します。')+'途中まででも、確認できた行動について結果を表示できます。</p></div>';
}
function emptyAnswer() { return {status:null,selected:[],frequency:null,context:null,contextChecks:[]}; }
function getAnswer(q) { return state.answers[q.id] || emptyAnswer(); }
function questionValid(q) {
  if(isSafety(q)) {
    const s=state.safety[q.id]; if(!s?.status) return false;
    if(safetyConflicts(s).length) return false;
    if(!['recent','past','other'].includes(s.status)&&['yes','unsure'].includes(s.currentRisk)) return false;
    return isQuick() || !['recent','past','other'].includes(s.status) || !!s.currentRisk;
  }
  const a=getAnswer(q);
  if(!a.status) return false;
  if(a.status!=='answered') return true;
  if(!a.selected.length) return false;
  if(isQuick()) return !(concern(q,a)&&['protective','unclear'].includes(a.context));
  if(!concern(q,a)) return true;
  if(contextualIds.has(q.id)&&!a.context) return false;
  if(a.context==='unclear') return true;
  if(a.context==='protective') return canProtect(q,a)&&['need','limited','respect'].every(k=>a.contextChecks.includes(k));
  return Number.isInteger(a.frequency)&&a.frequency>=1&&a.frequency<=4;
}
function renderSidebar() {
  const active=activeQuestions();
  const groups=[...DOMAINS.map(d=>({name:d.name,questions:dailyQuestions().filter(q=>q.domain===d.id)})),{name:'安全の確認',questions:SAFETY_QUESTIONS}];
  return '<aside class="quiz-sidebar" aria-label="質問の進み具合"><span class="eyebrow">振り返る関わり方</span>'+groups.map(g=>'<div class="step-group"><h3>'+esc(g.name)+'</h3><div class="step-items">'+g.questions.map(q=>{
    const idx=active.findIndex(x=>x.id===q.id); const a=isSafety(q)?state.safety[q.id]:state.answers[q.id];
    const cls=idx===state.position?'active':a?.status==='skip'?'skipped':questionValid(q)?'done':'';
    return '<button class="step-item '+cls+'" data-action="jump" data-index="'+idx+'" aria-label="質問'+(idx+1)+' '+(cls==='done'?'回答済み':cls==='skipped'?'スキップ':cls==='active'?'現在の質問':'未回答')+'" '+(cls==='active'?'aria-current="step"':'')+'>'+(cls==='done'?icon('check',14):idx+1)+'</button>';
  }).join('')+'</div></div>').join('')+'<button class="sidebar-result" data-action="results">ここまでの結果を見る</button></aside>';
}
function contextConditions(q) {
  const common=['目的に合った必要な範囲・時間にとどめていた','本人の意向や必要な支援を確認し、人格否定・脅し・罰は伴っていなかった'];
  const specific={
    Q01:['道路への飛び出しや人への攻撃など、目前の具体的な危険があった','危険を止める短い声だけで、安全が戻った後に叱責を続けていなかった','人格否定・見捨てる脅し・痛みを与える罰は伴っていなかった'],
    Q09:['言語・障害・その時の状態に応じて、本人に必要な代弁だった',common[0],common[1]],
    Q10:['年齢に応じた監督、または、いじめ・搾取など具体的な危険への対応だった','確認する範囲や期間を限定し、緊急時を除いて説明し、見直していた','本人のプライバシーにも配慮し、服従を求める罰や脅しは伴っていなかった'],
    Q11:['体調・障害などの具体的な支援ニーズがあり、失敗させたくないという親の気持ちだけの先回りではなかった',common[0],common[1]],
    Q12:['具体的な安全・費用・時間等の事情があり、親の好みだけによる制限ではなかった',common[0],'事情を説明して本人の意向を聞き、可能な代案や見直しを考えていた'],
    Q16:['目前の具体的な危険への対応で、その瞬間の短い指示を優先した','安全が戻った後には、理由を説明して本人の意見を聞く機会があった','異なる意見を持つこと自体を罰したり、人格を否定したりしていなかった']
  };
  return specific[q.id]||['具体的に必要な保護・援助だった',...common];
}
function renderContext(q,a) {
  if(!contextualIds.has(q.id)||!concern(q,a)) return '';
  const options=[['review','必要な保護・援助とは別に、この対応をした場面があった'],['mixed','必要な保護・援助の場面と、それ以外の場面の両方があった']];
  if(canProtect(q,a)) options.push(['protective','必要な保護・援助だけだった（条件を確認する）']);
  options.push(['unclear','区別が難しい・思い出せない']);
  return '<section class="context-panel" aria-labelledby="context-title"><h3 id="context-title">'+icon('shield',19)+'そのときの状況も確認します</h3>'+
    paragraph(q.context,'small-text')+
    (!canProtect(q,a)?'<p class="small-text">選んだ言動は、必要な保護・援助があったという理由だけでは除外できません。必要な制止・説明・支援だけだった場合は、上の選択肢を見直してください。区別できない場合は保留にできます。</p>':'')+
    (a.context==='protective'&&!canProtect(q,a)?'<p class="field-error" role="alert">以前の「保護・援助」の回答は、選択肢の内容と一致しないため保留しています。対応または状況を選び直してください。</p>':'')+
    '<div class="context-options">'+options.map(([id,label])=>'<label class="context-option '+(a.context===id?'selected':'')+'"><input type="radio" name="context" id="context-'+id+'" value="'+id+'" '+(a.context===id?'checked':'')+'><span>'+esc(label)+'</span></label>').join('')+'</div>'+
    (a.context==='protective'&&canProtect(q,a)?'<div class="protective-checks"><p class="small-text">あてはまる条件をすべて確認してください。親の意図だけでなく、実際の状況で考えてください。</p>'+contextConditions(q).map((text,i)=>'<label class="inline-check"><input type="checkbox" name="context-check" id="context-check-'+i+'" value="'+['need','limited','respect'][i]+'" '+(a.contextChecks.includes(['need','limited','respect'][i])?'checked':'')+'><span>'+esc(text)+'</span></label>').join('')+'</div>':'')+
    (a.context==='unclear'?'<p class="small-text muted">この項目は点数を保留し、状況を考えるための解説を結果で表示します。</p>':'')+'</section>';
}
function renderFrequency(q,a) {
  if(!concern(q,a)||a.context==='protective'||a.context==='unclear'||(contextualIds.has(q.id)&&!a.context)) return '';
  return '<section class="frequency-panel" aria-labelledby="frequency-title"><h3 id="frequency-title">この対応をした日は、何日ありましたか？</h3>'+
    '<p class="small-text muted">'+(a.context==='mixed'?'必要な保護・援助以外の対応をした日だけ数えてください。':'直近30日を振り返ってください。')+' 同じ日に複数回した場合は1日と数えます。</p>'+
    '<div class="frequency-grid">'+[1,2,3,4].map(n=>'<label class="frequency-option '+(a.frequency===n?'selected':'')+'"><input type="radio" name="frequency" id="frequency-'+n+'" value="'+n+'" '+(a.frequency===n?'checked':'')+'><span>'+days[n]+'</span></label>').join('')+'</div></section>';
}
function renderRegularQuestion(q) {
  const a=getAnswer(q),domain=domainMap[q.domain],quick=isQuick();
  return '<div class="question-meta"><span class="badge">'+esc(domain.name)+'</span><span class="small-text muted">複数選択できます</span></div>'+
    '<h1 class="question-title">'+esc(q.scenario)+'</h1><p class="question-hint">直近30日に実際にした対応を、1回だけのものも含めて選んでください。</p>'+
    (q.id==='Q10'?'<p class="question-age-note">スマホ・SNSなどの私的な連絡手段を使っていない場合は「この場面はなかった」を選べます。</p>':'')+
    (quick&&q.id==='Q12'?'<div class="safety-context">'+icon('info',19)+'<p class="small-text">安全・費用・時間や、本人に必要な支援など、具体的な事情による必要な制限はC・Dに含めません。侮辱や脅しまで必要な制限として除くことはできません。区別が難しい場合は「状況の判断を保留する」を選べます。</p></div>':'')+
    '<fieldset class="option-list"><legend class="sr-only">実際にした対応</legend>'+q.options.map(o=>'<label class="answer-option '+(a.status==='answered'&&a.selected.includes(o.id)?'selected':'')+'"><input type="checkbox" name="response-option" id="option-'+o.id+'" value="'+o.id+'" '+(a.status==='answered'&&a.selected.includes(o.id)?'checked':'')+'><span class="option-letter">'+o.id+'</span><span class="option-text">'+esc(o.label)+'</span></label>').join('')+'</fieldset>'+
    '<div class="status-options" role="group" aria-label="この質問にあてはまる場面がない場合など">'+Object.entries(statusLabels).filter(([id])=>id!=='context_hold'||(quick&&q.id==='Q12')).map(([id,label])=>'<button class="status-button '+(a.status===id?'selected':'')+'" data-action="answer-status" data-status="'+id+'" aria-pressed="'+(a.status===id)+'">'+esc(label)+'</button>').join('')+'</div>'+
    (quick?(concern(q,a)&&['protective','unclear'].includes(a.context)?'<p class="field-error" role="alert">以前の状況の回答が保留になっています。実際の対応を選び直すか、「状況の判断を保留する」を選んでください。</p>':''):renderContext(q,a)+renderFrequency(q,a))+
    (a.status==='context_hold'?'<p class="small-text muted">この場面の件数と傾向は保留します。詳しい版では、状況を追加で確認できます。</p>':'')+
    (a.status==='no_scene'?'<p class="small-text muted">'+(quick?'この場面は集計の分母から除きます。報告なしとしては扱いません。':'この質問は点数の計算から除きます。0点としては扱いません。')+'</p>':'');
}
function safetyTitle(id) { return {S01:'身体に苦痛を与える対応',S02:'生活に必要なものを我慢させる対応',S03:'締め出し・閉じ込め・置き去り',S04:'子どもが見聞きする家族への暴力'}[id]; }
function renderSafetyQuestion(q) {
  const a=state.safety[q.id]||{status:null,currentRisk:null},quick=isQuick();
  const conflicts=safetyConflicts(a);
  const opts=[['none','この30日にはなかった'],['recent',q.id==='S04'?'この30日に、自分が行った':'この30日にあった'],['past',q.id==='S04'?'この30日にはないが、それ以前に自分が行った':'この30日にはないが、それ以前にあった']];
  if(q.id==='S04') opts.push(['other','この30日に、他の人による行為があった']);
  opts.push(['unknown','思い出せない'],['skip','今回は回答しない']);
  const current=['recent','past','other'].includes(a.status);
  return '<div class="question-meta"><span class="badge safety-badge">安全の確認</span><span class="small-text muted">1つ選んでください</span></div>'+
    '<h1 class="question-title">'+esc(q.scenario)+'</h1><p class="question-hint">点数とは別に、今後の接し方や支援を考えるための質問です。</p>'+
    '<div class="safety-context">'+icon('info',19)+paragraph(q.context,'small-text')+'</div>'+
    (conflicts.length?'<section class="callout warning"><h3>安全に関する複数の回答を確認してください</h3><p>これまでの回答：'+esc(safetyReportsText(a))+'</p><p>未確認の報告をすべて保持しています。今回の回答を選び直したうえで、今の安全も確認してください。</p><div class="button-row">'+[a.status,...conflicts].map(status=>button(esc(safetyStatusLabel(status))+'で確認する','confirm-safety','secondary small','data-status="'+status+'"')).join('')+'</div></section>':'')+
    '<fieldset class="option-list"><legend class="sr-only">行動の有無</legend>'+opts.map(([id,label])=>'<label class="answer-option '+(a.status===id?'selected':'')+'"><input type="radio" name="safety-status" id="safety-'+id+'" value="'+id+'" '+(a.status===id?'checked':'')+'><span class="option-text">'+esc(label)+'</span></label>').join('')+'</fieldset>'+
    (!quick&&current?'<section class="context-panel"><h3>今の安全について</h3><p>'+ (a.status==='other'?'今、子どもやあなたに危険・けががある、または他の人の暴力が再び起きそうな状況ですか？':'今、子どもや家族に危険・けががある、または同じことをしてしまいそうな状況ですか？')+'</p><div class="context-options">'+[['yes','はい'],['no','今はその状況ではない'],['unsure','判断が難しい']].map(([id,label])=>'<label class="context-option '+(a.currentRisk===id?'selected':'')+'"><input type="radio" name="current-risk" id="risk-'+id+'" value="'+id+'" '+(a.currentRisk===id?'checked':'')+'><span>'+label+'</span></label>').join('')+'</div></section>':'')+
    (quick&&current?'<div class="callout warning"><p>この版では、今の安全までは確認していません。現在、危険やけががある場合はチェックの完了を待たずに、安全の確保や相談を優先してください。</p>'+button('安全と相談先を確認する','support','secondary small')+'</div>':'')+
    (['yes','unsure'].includes(a.currentRisk)?supportCallout(true):'')+
    (!current&&['yes','unsure'].includes(a.currentRisk)?'<p class="field-error" role="alert">保存された行動の回答と安全の情報が一致していません。今の状況を確認し、上の回答を選び直してください。</p>':'')+
    (a.status==='other'?'<p class="small-text">他の人の行為を、回答者自身の加害として扱うことはありません。安全を保つための相談先を確認できます。</p>':'');
}
function renderQuiz() {
  if(!state.profile.age) return renderSetup();
  const active=activeQuestions(),total=active.length,q=active[state.position]||active[0];
  const count=answeredCount(), pct=Math.round(count/total*100);
  return '<div class="container view quiz-view"><div class="quiz-top"><button class="back-button" data-action="home">ホーム</button><button class="nav-button" data-action="results">ここまでの結果を見る</button></div>'+
    '<div class="progress-meta"><span><span class="mode-pill">'+modeName()+'</span> 質問 <strong>'+(state.position+1)+'</strong> / '+total+'</span><span>'+count+'問の回答が完了</span></div>'+
    '<div class="progress-track" role="progressbar" aria-label="回答の進捗" aria-valuenow="'+count+'" aria-valuemin="0" aria-valuemax="'+total+'"><div class="progress-fill" style="width:'+pct+'%"></div></div>'+
    '<div class="quiz-layout">'+renderSidebar()+'<section class="quiz-main"><div class="question-card">'+(isSafety(q)?renderSafetyQuestion(q):renderRegularQuestion(q))+
    (formError?'<p class="field-error" role="alert">'+esc(formError)+'</p>':'')+
    '<div class="question-actions">'+button('前の質問','previous','ghost',state.position===0?'disabled':'')+
    '<div class="question-actions-right"><button class="back-button" data-action="skip-next">あとで答える</button>'+button(state.position===total-1?'結果を見る':'次の質問','next')+'</div></div></div>'+
    '<div class="save-bar"><label class="inline-check"><input type="checkbox" id="save-quiz" '+(state.saveEnabled?'checked':'')+'><span>この端末に途中保存する</span></label><span class="small-text muted">'+(state.saveEnabled?'このブラウザーに保存中':'ページを閉じると回答は消えます')+'</span></div></section></div></div>';
}
function referencesHtml(ids) {
  return '<div class="reference-chips">'+list(ids).map(id=>{
    const r=referenceMap[id]; if(!r) return '';
    return '<a class="reference-chip" href="'+esc(r.url)+'" target="_blank" rel="noopener noreferrer">'+icon('book',15)+esc(r.author)+'</a>';
  }).join('')+'</div>';
}
function selectedLabels(q,a,onlyConcerns=false) {
  return q.options.filter(o=>list(a?.selected).includes(o.id)&&(!onlyConcerns||q.concernOptions.includes(o.id))).map(o=>o.label);
}
function safetyStatusLabel(status) { return {none:'この30日の報告なし',recent:'この30日に報告あり',past:'それ以前の報告あり',other:'他の人による行為の報告',unknown:'未確認（思い出せない）',skip:'未確認（回答しない）'}[status]||'未確認（未回答）'; }
function getResult(data=state) {
  const result=isQuick(data)?assessQuick(data):assess(data,QUESTIONS,DOMAINS);
  result.safety.conflicts=SAFETY_QUESTIONS.filter(q=>safetyConflicts(data.safety[q.id]).length).map(q=>q.id);
  result.safety.unconfirmed=[...new Set([...result.safety.unconfirmed,...result.safety.conflicts])];
  return result;
}
function sampleState() {
  const demo=freshState('detailed'); demo.profile.age=12;
  const scores=[2,2,1,1,4,3,3,2,2,1,1,1,2,1,1,1,1,1,1,1];
  QUESTIONS.forEach((q,i)=>{demo.answers[q.id]={status:'answered',selected:['C'],frequency:scores[i],context:'review',contextChecks:[]};});
  demo.answers.Q05.selected.push('A'); demo.answers.Q15.selected.push('B');
  SAFETY_QUESTIONS.forEach(q=>{demo.safety[q.id]={status:'none',currentRisk:null};});
  return demo;
}
let sampleMode=false;
function viewData() { return sampleMode?sampleState():state; }
function supportCallout(urgent=false) {
  return '<section class="callout '+(urgent?'danger':'warning')+' safety-callout"><div class="callout-title">'+icon('shield',22)+'<h2>'+(urgent?'今の安全を先に確かめてください':'点数にかかわらず、先に見直したい対応があります')+'</h2></div>'+
    '<p>'+(urgent?'子どもや家族に危険・けががある、または同じことが起こりそうな場合は、必要な保護や医療、大人の支援を先に確保してください。':'今回報告された安全に関わる対応は、強みや低い総合点で打ち消されません。今の安全と、次に同じことを起こさないための支援を確認しましょう。')+'</p>'+
    '<div class="support-inline"><a href="tel:189">虐待の相談・通告 189</a><a href="tel:0120189783">子育ての相談 0120-189-783</a></div>'+
    (urgent?'<p class="small-text">事件・事故の緊急通報は <a href="tel:110">110</a>、救急車が必要なけが・急病は <a href="tel:119">119</a>。</p>':'')+
    '<button class="button secondary small" data-action="support">相談先と公的情報を見る</button></section>';
}
function typeText(result) {
  if(result.mode==='quick') return !result.eligible?'確認できる回答がありません':result.types.length?result.types.map(t=>t.type).join('・'):'今回確認した言動の報告なし';
  if(!result.eligible) return '判定保留';
  if(!result.types.length) return '特定の傾向の報告なし';
  return result.types.map(t=>t.type).join('・');
}
function scoreString(result) { return result.eligible ? String(result.score) : '—'; }
function questionDetails(q,a,data) {
  const quick=isQuick(data);
  const score=quick?scoreQuickAnswer(q,a):scoreAnswer(q,a);
  const protective=!quick&&a?.context==='protective'&&scoreAnswer(q,a)===0;
  const held=a?.status==='answered'&&concern(q,a)&&score===null;
  const reported=score>0;
  const labels=selectedLabels(q,a);
  const supportive=a?.status==='answered'&&!concern(q,a);
  let badge=protective?'必要な保護・援助として確認':held?(quick?'状況の確認が必要':'状況・頻度の確認が必要'):reported?'見直したい対応あり':supportive?'続けたい対応あり':'回答を振り返る';
  const status= a?.status==='answered' ? labels.map(t=>'<li>'+esc(t)+'</li>').join('') : '<li>'+esc(statusLabels[a?.status]||'未回答')+'</li>';
  return '<details class="detail-card" id="detail-'+q.id+'"><summary class="details-summary"><span><span class="detail-badge">'+badge+'</span><strong>'+esc(q.scenario)+'</strong></span><span class="details-chevron" aria-hidden="true"></span></summary>'+
    '<div class="detail-body"><div class="answer-recap"><h4>あなたが選んだ対応</h4><ul>'+status+'</ul>'+
    (reported?'<p class="small-text">'+(quick?'この30日にしたと回答した対応です。手軽版では日数を確認していません。':'対象の対応があった日：'+days[a.frequency]+'／直近30日')+'</p>':'')+'</div>'+
    (protective?'<div class="callout success"><p>今回の回答では、確認した条件を満たす保護・援助のみとして、日常項目の懸念点に加えていません。</p></div>':'')+
    (held?'<div class="callout"><p>この項目は'+(quick?'件数の集計':'点数')+'を保留しています。以下は選んだ対応を理解するための一般的な解説です。</p></div>':'')+
    (supportive?'<h4>選んだ対応から確認できたこと</h4>'+['A','B'].filter(id=>list(a.selected).includes(id)&&q.strengths?.[id]).map(id=>paragraph(q.strengths[id])).join(''):
      '<h4>'+(protective?'日常的な威圧・支配との違い':'この対応を見直したい理由')+'</h4>'+(protective?'<p>以下は、必要な保護・援助の範囲を超えた言動についての一般的な説明です。今回の保護行動を、そのまま問題と判定したものではありません。</p>':'')+paragraph(q.why)+'<h4>研究で報告されていること</h4>'+paragraph(q.evidence))+
    '<h4>状況によって異なる点</h4>'+paragraph(q.context)+
    '<h4>次に試せる言葉・行動</h4>'+paragraph(q.alternative,'detail-alternative')+
    '<h4>根拠と、分かっていないこと</h4>'+paragraph(q.limits,'small-text muted')+
    referencesHtml(q.refs)+'<div class="detail-source-list">'+q.refs.map(id=>{const r=referenceMap[id];return r?'<p class="small-text"><b>'+esc(r.author)+'</b> — '+esc(r.kind)+'</p>':'';}).join('')+'</div>'+
    (!sampleMode?'<button class="back-button" data-action="edit-question" data-id="'+q.id+'">この回答を見直す</button>':'')+'</div></details>';
}
function safetyDetails(q,data) {
  const a=data.safety[q.id],conflicts=safetyConflicts(a);
  return '<details class="detail-card" id="detail-'+q.id+'"><summary class="details-summary"><span><strong>'+esc(safetyTitle(q.id))+'</strong><small>'+esc(safetyStatusLabel(a?.status))+(conflicts.length?'（ほかにも未確認の報告あり）':'')+'</small></span><span class="details-chevron" aria-hidden="true"></span></summary><div class="detail-body">'+
    '<div class="answer-recap"><h4>あなたの回答</h4>'+paragraph(safetyReportsText(a))+paragraph(currentRiskLabel(a),'small-text')+(conflicts.length?'<p class="small-text">異なる報告をすべて保持しています。今回の回答を確認してください。</p>':'')+'</div>'+
    '<p class="small-text muted">以下は、この行為と状況を理解するための一般的な説明です。未回答や他者の行為を、あなた自身の行為と判断するものではありません。</p>'+
    '<h4>子どもにとって問題となる点</h4>'+paragraph(q.why)+'<h4>研究・公的資料で示されていること</h4>'+paragraph(q.evidence)+
    '<h4>状況によって異なる点</h4>'+paragraph(q.context)+'<h4>次に確認したい行動・支援</h4>'+paragraph(q.alternative)+
    '<h4>根拠と、分かっていないこと</h4>'+paragraph(q.limits,'small-text muted')+referencesHtml(q.refs)+
    (!sampleMode?'<button class="back-button" data-action="edit-question" data-id="'+q.id+'">この回答を見直す</button>':'')+'</div></details>';
}
function strengthMarkup(s,data) {
  const q=QUESTIONS.find(q=>q.id===s.questionId); if(!q) return '';
  const text=s.text||q.strengths?.[s.optionId];
  return '<article class="feedback-item"><span class="feedback-label">'+esc(domainMap[q.domain].positiveTitle)+'</span>'+paragraph(text)+
    '<p class="small-text muted">回答：'+esc(q.options.find(o=>o.id===s.optionId)?.label||'')+'</p></article>';
}
function challengeMarkup(item,data) {
  const q=item.question||QUESTIONS.find(q=>q.id===item.questionId); if(!q) return '';
  const labels=selectedLabels(q,item.answer,true);
  return '<article class="feedback-item"><span class="feedback-label">'+esc(domainMap[q.domain].name)+'</span>'+
    '<ul>'+labels.map(t=>'<li>'+esc(t)+'</li>').join('')+'</ul><p class="small-text muted">'+(isQuick(data)?'この30日にしたと回答した対応です。頻度や深刻さの順位は付けていません。':'直近30日に '+days[item.answer.frequency]+'。この場面の対応を優先して見直します。')+'</p>'+
    '<button class="back-button" data-action="open-detail" data-id="'+q.id+'">理由・状況による違い・研究を見る</button></article>';
}
function actionMarkup(result,data) {
  if(result.safety.conflicts.length) return '<article class="action-card"><span class="eyebrow">まず優先すること</span><h3>安全の回答と、今の状況を確認する。</h3><p>安全に関する異なる回答が残っています。行為をした人や時期を決めつけず、現在の危険・けがと必要な支援を先に確認してください。</p>'+result.safety.conflicts.map(id=>'<p>'+esc(safetyTitle(id))+'：'+esc(safetyReportsText(data.safety[id]))+'</p>'+button('この安全項目を確認する','edit-question','secondary small','data-id="'+id+'"')).join('')+'<p>今、危険がある場合は回答の完了を待たず、安全確保や相談を優先してください。</p>'+button('安全と相談先を確認する','support','secondary')+'</article>';
  const urgent=result.safety.urgent.length>0||result.safety.recent.length>0||result.safety.other.length>0;
  if(urgent) {
    const id=result.safety.urgent[0]||result.safety.recent[0]||result.safety.other[0]; const q=SAFETY_QUESTIONS.find(q=>q.id===id);
    const other=data.safety[id]?.status==='other',own=['recent','past'].includes(data.safety[id]?.status);
    return '<article class="action-card"><span class="eyebrow">まず優先すること</span><h3>子どもとあなたの安全と、<br>大人の支えを確保する。</h3>'+paragraph(own||other?q?.alternative:'今の安全を確認し、必要な保護や大人の支援につなげてください。')+
      '<div class="action-steps"><p><b>先に確認したいこと</b><br>'+esc(safetyTitle(id))+(other?'（他の人による行為）':'')+'</p><p>'+(other?'他の人の暴力を、あなた自身の加害として扱うことはありません。子どもとあなたの安全を確保し、安全な大人や相談先の支援につなげてください。':own?'この対応は、少しずつ減らす練習ではなく、中止と安全の確保を先に進めます。必要な支援を一緒に確保してください。':'行為の有無と現在の安全に未確認の情報があります。回答を確認し、必要な保護や支援を先に確保してください。')+'</p></div>'+
      button('安全と相談先を確認する','support','secondary')+referencesHtml(q?.refs||['R01'])+'</article>';
  }
  const item=result.priority||result.challenges[0];
  if(!item) {
    if(result.totalValid===0 && !result.strengths.length) return '<div class="empty-state"><h3>回答した場面から、次の一歩を考えます。</h3><p>まず答えられる質問から進めてみてください。すべての質問に答えなくても、確認できた対応の解説を読めます。</p>'+backToWork()+'</div>';
    const strong=result.strengths[0]; const q=strong?QUESTIONS.find(q=>q.id===strong.questionId):null;
    return '<article class="action-card"><span class="eyebrow">続けたい接し方</span><h3>'+esc(q?domainMap[q.domain].positiveTitle:'今の接し方を、具体的な場面で振り返る')+'</h3>'+
      paragraph(q?strong.text:'今回の回答では、優先して変える対象行動の情報が十分ではありません。思い出せる場面や、状況の確認が必要な回答を振り返ってみましょう。')+
      (q?'<div class="action-quote">'+nl(q.alternative)+'</div><p>次に同じ場面があったときも、この対応を続けられたか振り返ってみましょう。</p>':'')+'</article>';
  }
  const q=item.question;
  return '<article class="action-card"><div class="action-card-heading"><span class="eyebrow">次の場面で試す、ひとつの行動</span>'+icon('leaf',30)+'</div>'+
    '<h3>'+esc(domainMap[q.domain].positiveTitle)+'</h3><p class="small-text muted">'+esc(q.scenario)+'</p>'+
    '<div class="action-steps"><h4>変えていきたい対応</h4><ul>'+selectedLabels(q,item.answer,true).map(t=>'<li>'+esc(t)+'</li>').join('')+'</ul><h4>代わりに試すこと</h4>'+paragraph(q.action)+'</div>'+
    '<div class="action-quote">'+nl(q.alternative)+'</div>'+
    '<div class="action-goal"><b>次の機会・1週間の振り返り</b>'+paragraph(q.goal)+'</div>'+
    (result.strengths.length?'<p class="small-text">回答から確認できた接し方も活かしながら、まずはこの場面に取り組みましょう。場面がなかった週は「機会なし」で構いません。</p>':'')+
    '<button class="back-button" data-action="open-detail" data-id="'+q.id+'">この提案の根拠と状況の違いを読む</button></article>';
}
function upgradeCard() {
  return '<section class="upgrade-card" aria-labelledby="upgrade-title"><div><span class="eyebrow">もう少し、深く振り返るなら</span><h2 id="upgrade-title">日数や状況も含めて確かめる。</h2><p>同じ質問に選んだ回答を引き継いで、24問の詳しいチェックへ進めます。詳しい版ですでに答えた日常項目は保持し、新たな安全の報告は確認し直します。</p></div>'+button('もっと詳しくチェックする','upgrade','primary')+'</section>';
}
function resultOverview(r,data) {
  const quick=isQuick(data),mainType=r.types[0];
  const typeDescription=quick?(r.eligible?'各領域1問の回答から確認できた傾向です。複数の傾向がある場合は、すべて表示しています。':'場面がない・保留・未回答は、報告なしとして扱いません。答えられる場面から振り返れます。'):!r.eligible?'有効な回答数が足りないため、タイプの判定を保留しています。下に、回答から確認できた強みや接し方を表示します。':mainType?domainMap[mainType.id].summary:'回答した日常項目では、対象となる言動の報告はありませんでした。';
  const type='<section class="result-card type-card"><span class="result-index">① 親のタイプ</span><p class="small-text">'+(quick?'今回確認できた傾向':'今回の回答で目立った関わり方')+'</p><h2>'+esc(typeText(r))+'</h2>'+paragraph(typeDescription)+'<p class="small-text muted">性格の診断ではなく、今回の回答内での傾向です。</p></section>';
  if(quick) return '<div class="results-grid">'+type+'<section class="result-card score-card quick-score"><span class="result-index">② 毒親度（手軽版）</span><p>見直したい対応が報告された場面</p><div class="score-display"><strong class="score-number">'+(r.eligible?r.reportedCount:'—')+'</strong><span class="score-denominator">'+(r.eligible?'/ '+r.totalValid+' 場面':'未集計')+'</span></div><p>'+(r.eligible?'確認できた'+r.totalValid+'場面中、'+r.reportedCount+'場面に報告がありました。':'集計できる回答がまだありません。')+'</p><p class="small-text muted">5場面のうち、場面なし・保留・未回答は'+r.missingCount+'場面です。頻度や影響の大きさを測る結果ではなく、詳しい版の点数とは比較できません。</p></section></div>'+
    '<details class="domain-breakdown quick-domains"><summary>確認した場面と、結果の見方</summary><div class="domain-bars">'+r.domains.map(d=>'<div class="domain-row"><span>'+esc(d.name)+'</span><b>'+(d.valid?(d.reported?'見直したい対応あり':'今回の報告なし'):'未確認')+'</b><small>'+d.valid+' / 1場面</small></div>').join('')+'</div><p class="small-text">各領域1問について、見直したい対応を1つでも選んだ場面を1件と数えます。同じ場面で複数選んでも1件です。続けたい対応も選んだ場合、それで見直したい対応を打ち消しません。</p><p class="small-text">場面なし・不明・保留・未回答は分母から除きます。タイプに強さの順位は付けません。安全の4問はこの件数に含めず、別に確認します。</p></details>';
  return '<div class="results-grid">'+type+'<section class="result-card score-card"><span class="result-index">② 毒親度</span><div class="score-display"><strong class="score-number">'+scoreString(r)+'</strong><span class="score-denominator">/ 100 点</span></div><div class="score-track"><div class="score-fill" style="width:'+(r.score??0)+'%"></div></div><p>'+(r.eligible?'日常の関わりの振り返りスコア':'回答不足のため、点数は未算出')+'</p><p class="small-text muted">有効回答 '+r.totalValid+' / 20問。診断や影響の確率を示す数値ではありません。</p></section></div>'+
    '<details class="domain-breakdown"><summary>点数の内訳と計算方法</summary><div class="domain-bars">'+r.domains.map(d=>'<div class="domain-row"><span>'+esc(d.name)+'</span><div class="domain-track"><div class="domain-fill" style="width:'+(d.score??0)+'%"></div></div><b>'+(d.score===null?'未算出':Math.round(d.score)+'点')+'</b><small>'+d.valid+' / '+d.count+'問</small></div>').join('')+'</div>'+
    '<p class="small-text">各項目は、対象となる対応をした日数から0〜4点を計算します（0日・1日・2〜3日・4〜7日・8日以上）。領域点は有効項目の平均×25、総合点は5領域の平均です。</p><p class="small-text">各領域で4問中3問以上、全体で20問中16問以上が有効な場合に総合点を表示します。場面なし・不明・未回答は0点にせず除外します。頻度区分と採点は独自の試作用設計です。</p></details>';
}
function renderResults() {
  const data=viewData(),r=getResult(data),quick=isQuick(data);
  const hasSafety=r.safety.recent.length||r.safety.urgent.length;
  const safetyPriority=hasSafety||r.safety.other.length||r.safety.conflicts.length;
  const selectedQs=dailyQuestions(data).filter(q=>data.answers[q.id]?.status==='answered'&&list(data.answers[q.id].selected).length);
  const others=dailyQuestions(data).filter(q=>data.answers[q.id]?.status&&data.answers[q.id].status!=='answered');
  return '<div class="container view results-view" id="results-view">'+
    (sampleMode?'<div class="sample-banner"><b>結果のサンプル</b><span>架空の回答による表示です。あなたの回答は変更していません。</span>'+button('チェックに戻る','exit-sample','secondary small')+'</div>':'')+
    '<div class="results-heading"><div><span class="mode-pill">'+modeName(data)+'</span><h1>今回の気づきを、<br>次の接し方に。</h1><p>'+data.profile.age+'歳の子どもへの、入力時点の直近30日の対応'+(sampleMode?'（サンプル）':'')+'</p>'+(!sampleMode?paragraph(answerDateText(data),'small-text muted'):'')+'</div><div class="results-actions">'+button(icon('print',18)+'印刷・PDF','print','secondary small')+button(icon('save',18)+'結果を保存','download','secondary small')+'</div></div>'+
    (!sampleMode?'<p class="small-text muted">再開した回答や、別の版から引き継いだ回答には、異なる時点のものが含まれる場合があります。過去の回答は今日の状態へ自動更新されません。今を振り返るときは回答を見直してください。</p>':'')+
    (hasSafety?supportCallout(r.safety.urgent.length>0):'')+
    (r.safety.other.length?'<div class="callout warning"><h2>他の人による暴力の回答があります</h2><p>他者の行為を、あなた自身の加害とは扱いません。子どもとあなたの安全のために、相談先を確認できます。</p>'+button('相談先を確認','support','secondary small')+'</div>':'')+
    (r.safety.unconfirmed.length?'<div class="callout safety-unconfirmed"><b>安全項目に未確認の情報があります</b><p>'+r.safety.unconfirmed.length+' / 4項目で、行動の有無または現在の安全が未確認です。'+(quick?'手軽版では、今の危険について追加質問をしていません。':'')+'結果の件数や点数は安全確認の代わりにはなりません。</p>'+button('安全と相談先を確認する','support','secondary small')+'</div>':'')+
    (r.safety.conflicts.length?'<div class="callout warning"><h2>安全の回答を確認してください</h2><p>チェックの間で異なる回答があります。新たな報告を「なし」として扱わず、すべて保持しています。</p>'+r.safety.conflicts.map(id=>'<p>'+esc(safetyTitle(id))+'：'+esc(safetyReportsText(data.safety[id]))+'</p>'+button('この安全項目を確認する','edit-question','secondary small','data-id="'+id+'"')).join('')+'</div>':'')+
    resultOverview(r,data)+(quick&&!sampleMode?upgradeCard():'')+
    '<section class="feedback-section"><div class="section-heading"><div><span class="result-index">③ あなたの強みと課題</span><h2>続けたいこと。見直したいこと。</h2></div></div>'+
    '<div class="results-grid"><section class="result-card strength-card"><h3>'+icon('sun',24)+'回答から確認できた強み</h3>'+
    (r.strengths.length?r.strengths.map(s=>strengthMarkup(s,data)).join(''):'<p>今回の回答だけでは、具体的な強みを挙げる情報が十分ではありません。強みがないという意味ではありません。</p>')+
    '<p class="small-text muted">この30日に実際にできたと回答した対応です。いつもできる能力とまでは断定しません。</p></section>'+
    '<section class="result-card challenge-card"><h3>'+icon('leaf',24)+(quick?'見直したい課題':'優先して見直したい課題')+'</h3>'+
    (r.challenges.length?r.challenges.map(item=>challengeMarkup(item,data)).join(''):'<p>'+(r.totalValid>0?'今回、回答が確定した日常項目では、優先して変える対象行動の報告はありませんでした。':'回答した内容から、見直したい対応を確認します。')+'</p>')+
    (safetyPriority?'<p class="small-text">安全に関わる回答への対応を、これらの日常項目より先に確認してください。</p>':'')+'</section></div></section>'+
    '<section class="next-step-section"><div class="section-heading"><div><span class="result-index">④ 今後変えていきたい子どもへの接し方</span><h2>まず、ひとつの場面から。</h2></div></div>'+actionMarkup(r,data)+'</section>'+
    '<section class="answer-explanations"><div class="section-heading"><div><span class="eyebrow">言動ごとの解説</span><h2>選んだ回答を、もう少し詳しく。</h2></div><p>問題点・状況による違い・研究・文献を確認できます。</p></div>'+
    '<div class="detail-list">'+selectedQs.map(q=>questionDetails(q,data.answers[q.id],data)).join('')+'</div>'+
    (!selectedQs.length?'<div class="empty-state"><p>具体的な対応を選ぶと、ここに解説が表示されます。</p></div>':'')+
    (others.length?'<details class="other-answers"><summary>場面なし・保留・回答しない項目（'+others.length+'）</summary><ul>'+others.map(q=>'<li>'+esc(q.scenario)+'<span>'+esc(statusLabels[data.answers[q.id].status])+'</span>'+(!sampleMode?'<button data-action="edit-question" data-id="'+q.id+'">見直す</button>':'')+'</li>').join('')+'</ul></details>':'')+'</section>'+
    '<section class="safety-summary"><h2>安全確認の回答</h2>'+(quick?'<p class="small-text muted">手軽版では、現在の危険やけがについて追加質問をしていません。この回答だけで今の安全を判断せず、危険がある場合は安全確保や相談を優先してください。</p>':'')+SAFETY_QUESTIONS.map(q=>safetyDetails(q,data)).join('')+'</section>'+
    '<div class="results-end"><p class="small-text muted">結果は回答時点の自己報告です。子どもの状態や家庭の状況を、この点数だけで判断することはできません。</p><div class="button-row">'+
    (sampleMode?button('自分のチェックをはじめる','exit-sample-start'):button('回答を見直す','resume','secondary')+button('最初からやり直す','restart','ghost'))+
    (quick&&!sampleMode?button('もっと詳しくチェックする','upgrade','primary'):'')+button('根拠文献を読む','sources','ghost')+'</div></div></div>';
}
function renderSources() {
  return '<div class="container view">'+pageHeading('研究・公的資料','根拠を、確かめる。','言動の説明に用いた16件の研究・資料です。質問と採点は独自の設計であり、これらの文献がアプリの診断精度を保証するものではありません。')+
    '<div class="source-toolbar"><label for="source-search" class="sr-only">文献を検索</label><input type="search" id="source-search" placeholder="著者・テーマ・文献名で検索"><span class="small-text muted">確認日 '+META.reviewDate+'</span></div>'+
    '<div class="sources-grid" id="source-list">'+REFERENCES.map(r=>'<article class="source-card" data-search="'+esc([r.author,r.title,r.kind,r.finding].join(' ').toLowerCase())+'"><span class="source-meta">'+esc(r.author)+'</span><h2 class="source-title">'+esc(r.title)+'</h2><p class="source-kind">'+esc(r.kind)+'</p><h3>確認できる知見</h3>'+paragraph(r.finding)+'<h3>適用上の限界</h3>'+paragraph(r.limits,'small-text muted')+'<a class="source-link" href="'+esc(r.url)+'" target="_blank" rel="noopener noreferrer">'+icon('book',17)+'原文・公式資料を読む</a></article>').join('')+'</div><p id="source-empty" hidden>該当する文献がありません。検索語を変えてください。</p><div class="page-bottom">'+backToWork()+(hasResponses()?button('結果へ戻る','results','ghost'):'')+'</div></div>';
}
function renderAbout() {
  return '<div class="container narrow view">'+pageHeading('このチェックについて','自分では気づきにくい接し方を、<br>振り返るために。','「セルフ毒親チェック」は、自分では気づきにくい子どもへの接し方の問題や課題に気づくためのツールです。6〜17歳の子どもへの、自分自身の接し方を振り返ります。')+
    '<div class="info-card"><h2>気づきを、これからの接し方へ</h2><p>直近30日の具体的な場面で、自分が実際にした対応を選びます。回答から、気づきにくかった問題や課題、できている強みを確かめ、今後変えていきたい接し方を考えます。</p><p>選んだ言動について、子どもにとって問題となる点や状況による違いを、研究・文献とともに確認できます。</p></div>'+
    '<div class="info-card"><h2>結果でお返しする4つのこと</h2><ol><li>今回の回答で目立った親のタイプ</li><li>日常の関わりを振り返る毒親度</li><li>回答から確認できた強みと課題</li><li>今後変えていきたい、具体的な接し方</li></ol></div>'+
    '<div class="info-card"><h2>2つのチェック方法</h2><p><b>手軽にチェック：9問・追加質問なし。</b>日常の5場面と安全の4問を確認します。毒親度は、見直したい対応が報告された場面の件数です。頻度や影響の大きさ、タイプの強弱は判定しません。</p><p><b>詳しくチェック：24問＋必要に応じた追加確認。</b>日常20問と安全4問から、日数や状況も踏まえて振り返ります。手軽版の結果から、選んだ回答を引き継いで進めます。未確認の日数や状況は追加で質問します。</p><p>2つの版の件数と点数は直接比較できません。どちらも、場面なし・不明・保留・未回答を問題なしとして扱いません。</p></div>'+
    '<div class="info-card"><h2>研究と、独自の質問を分けて考えます</h2><p>研究は、関わり方と子どもの状態の集団レベルの関連を扱っています。このアプリの質問、5つのタイプ、件数・点数の表示は独自に整理したもので、妥当性が検証された診断尺度ではありません。</p><p>親の性格、虐待の法的認定、子どもの将来を自動で判断するものではありません。</p></div>'+
    '<div class="info-card"><h2>状況の違いも確認します</h2><p>危険を止めるための短い声や制止、発達や障害に応じた援助、親が安全に落ち着く休止など、表面的には似ていても意味が異なる対応を説明します。</p><p>「子どものため」という意図だけで、侮辱や身体への罰を除外することはしません。</p></div>'+
    '<div class="info-card"><h2>対象と回答方法</h2><p>6〜17歳の子ども1人に対する、直近30日の自分自身の対応を選びます。場面がない、思い出せない場合も選択できます。安全確認4問は日常の点数とは別に扱います。</p></div>'+
    '<div class="page-bottom">'+backToWork()+button('根拠文献を読む','sources','secondary')+'</div></div>';
}
function renderPrivacy() {
  return '<div class="container narrow view">'+pageHeading('回答と保存について','あなたの端末で、振り返る。')+
    '<section class="info-card"><h2>回答の処理</h2><p>回答の採点と結果の作成は、このブラウザー内で行います。アプリの機能として、回答を外部の分析サービスやAIへ送信することはありません。名前・メールアドレス・連絡先の入力もありません。</p><p class="small-text muted">ページの配信・閲覧認証に必要な通信は発生します。根拠文献や相談先を開くと、それぞれの外部サイトへ移動します。</p></section>'+
    '<section class="info-card"><h2>途中保存は、あなたが選べます</h2><p>「この端末に回答を保存する」をオンにすると、回答と子どもの年齢を、このブラウザーのローカルストレージに保存します。同じ端末・ブラウザーで再開できます。</p><p>オフのときは、画面を開いている間だけ回答を保持します。共有端末での保存には注意してください。</p><label class="inline-check"><input type="checkbox" id="save-privacy" '+(state.saveEnabled?'checked':'')+'><span>この端末に回答を保存する</span></label></section>'+
    '<section class="info-card"><h2>回答を消す・結果を手元に残す</h2><p>「回答をすべて削除する」で、このアプリの端末内保存と現在の回答を削除できます。結果のテキスト保存や印刷は、結果画面から選べます。ダウンロードしたファイルは、保存先で別途管理してください。</p>'+button('回答をすべて削除する','delete-data','danger small')+'</section><div class="page-bottom">'+backToWork()+'</div></div>';
}
function renderSupport() {
  return '<div class="container narrow view">'+pageHeading('相談先','ひとりで抱えず、<br>大人の支えを。','子どもへの接し方に困ったときや、家庭の安全が心配なときに確認できる、日本の公的な窓口です。')+
    '<section class="callout danger"><h2>今、差し迫った危険があるとき</h2><p>事件・事故への緊急通報は110、救急車が必要なけが・急病は119です。安全を確保できる大人や、緊急の支援を頼ってください。</p><div class="button-row"><a class="button secondary" href="tel:110">110に電話する</a><a class="button secondary" href="tel:119">119に電話する</a></div><p class="small-text"><a href="https://www.npa.go.jp/goiken_index.html" target="_blank" rel="noopener noreferrer">警察庁の案内</a> ・ <a href="https://www.fdma.go.jp/mission/enrichment/kyukyumusen_kinkyutuhou/119.html" target="_blank" rel="noopener noreferrer">消防庁の案内</a></p></section>'+
    '<section class="info-card"><h2>虐待かもしれない、という心配</h2><p>児童相談所虐待対応ダイヤル</p><a class="phone-number" href="tel:189">189</a><p>匿名での相談・通告もできます。近くの児童相談所につながります。</p><a class="source-link" href="https://www.cfa.go.jp/policies/jidougyakutai/gyakutai-taiou-dial/" target="_blank" rel="noopener noreferrer">こども家庭庁の公式案内</a></section>'+
    '<section class="info-card"><h2>子育て・親子関係の相談</h2><p>児童相談所相談専用ダイヤル</p><a class="phone-number" href="tel:0120189783">0120-189-783</a><p>子どもの福祉に関する、さまざまな相談を受け付けています。</p><a class="source-link" href="https://www.cfa.go.jp/policies/jidougyakutai/gyakutai-taiou-dial/" target="_blank" rel="noopener noreferrer">公式情報を確認する</a></section>'+
    '<section class="info-card"><h2>文字で相談したいとき</h2><p>「親子のための相談LINE」など、子どもと保護者の相談窓口を確認できます。受付時間や対象地域は公式情報をご覧ください。</p><a class="source-link" href="https://kodomoshien.cfa.go.jp/no-gyakutai/" target="_blank" rel="noopener noreferrer">こども家庭庁の相談窓口を見る</a></section>'+
    '<p class="small-text muted">案内確認日：2026-11-23。日本国内向けの情報です。電話番号を押すと、お使いの端末の通話機能が開きます。</p><div class="page-bottom">'+button('元の画面に戻る','return','secondary')+'</div></div>';
}
function showDialog(title,text,onConfirm,label='続ける') {
  dialogLastFocus=document.activeElement;
  $('dialog-root').innerHTML='<div class="dialog-backdrop"><section class="dialog-card" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><h2 id="dialog-title">'+esc(title)+'</h2><p>'+esc(text)+'</p><div class="button-row"><button class="button danger" id="dialog-confirm">'+esc(label)+'</button><button class="button secondary" id="dialog-cancel">キャンセル</button></div></section></div>';
  const close=()=>{$('dialog-root').innerHTML='';dialogLastFocus?.focus();};
  $('dialog-cancel').onclick=close;
  $('dialog-confirm').onclick=()=>{close();onConfirm();};
  $('dialog-cancel').focus();
}
document.addEventListener('keydown',e=>{
  if(!$('dialog-root').children.length) return;
  if(e.key==='Escape'){e.preventDefault();$('dialog-cancel').click();}
  if(e.key==='Tab') { const elements=[$('dialog-confirm'),$('dialog-cancel')]; const i=elements.indexOf(document.activeElement); e.preventDefault();elements[(i+(e.shiftKey?-1:1)+2)%2].focus(); }
});
function toggleSave(checked) {
  state.saveEnabled=checked;
  if(checked) persist(); else clearStorage();
  toast(checked?'この端末への保存を有効にしました。':'保存をオフにし、端末内の保存データを削除しました。現在の回答は画面内に残ります。');
}
function begin() {
  if(!Number.isInteger(state.profile.age)||state.profile.age<6||state.profile.age>17){formError='子どもの年齢を選んでください。';render();$('child-age')?.focus();return;}
  sampleMode=false;
  const pending=activeQuestions().findIndex(q=>!questionValid(q));
  if(pending<0){navigate('results');return;}
  state.position=pending;
  persist();navigate('quiz');
}
function chooseCheck(mode) {
  if(!['quick','detailed'].includes(mode)) return;
  state=switchMode(state,mode);
  sampleMode=false;persist();
  navigate(checkComplete()?'results':hasResponses()&&state.profile.age?'quiz':'setup');
}
function upgrade() {
  if(sampleMode||!isQuick()) return;
  state=switchMode(state,'detailed',{upgrade:true});
  const pending=activeQuestions().findIndex(q=>!questionValid(q));
  state.position=pending<0?0:pending;
  if(pending>=0) state.completedAt=null;
  sampleMode=false;persist();navigate(pending<0?'results':'quiz');
  toast('選んだ回答を引き継ぎました。未回答の質問や、日数・状況を確認します。');
}
function next() {
  const active=activeQuestions(),q=active[state.position];
  if(!questionValid(q)) {
    formError=isQuick()?'回答を選んでください。答えにくい場合は「今回は回答しない」を選べます。':isSafety(q)?'回答と、表示されている場合は今の安全の状況を選んでください。':'実際にした対応を選び、表示されている状況・日数も確認してください。答えにくい場合は「今回は回答しない」を選べます。';
    render(); document.querySelector('.field-error')?.scrollIntoView({block:'center',behavior:'smooth'});return;
  }
  if(state.position===active.length-1){state.completedAt=checkComplete()?new Date().toISOString():null;persist();sampleMode=false;navigate('results');return;}
  state.position++;persist();navigate('quiz');
}
function textReport() {
  const data=viewData(),r=getResult(data),quick=isQuick(data);
  const degree=quick?(r.eligible?'確認できた'+r.totalValid+'場面中、見直したい対応の報告 '+r.reportedCount+'場面':'未集計'):(r.eligible?r.score+'/100点':'未算出');
  const parts=['セルフ毒親チェック｜子と親の心理学','自分では気づきにくい子どもへの接し方の問題や課題に気づくためのツールです。',modeName(data),sampleMode?'架空の回答によるサンプル':'入力時点の直近30日の振り返り','対象：'+data.profile.age+'歳',sampleMode?'':answerDateText(data),'出力：'+new Date().toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})+'（日本時間）','過去の回答は今日の状態へ自動更新されません。再開・引き継ぎには異なる時点の回答が含まれる場合があります。','','① 親のタイプ',typeText(r),'性格の診断ではなく、今回の回答内での傾向です。','','② 毒親度'+(quick?'（手軽版）':''),degree,quick?'場面なし・保留・不明・未回答：'+r.missingCount+'場面。頻度や影響の大きさは評価していません。詳しい版の点数とは比較できません。':'有効回答 '+r.totalValid+' / 20問。5領域それぞれ4問中3問以上、全体16問以上が必要です。','独自の振り返り指標であり、医学的診断や子どもの将来の判定ではありません。','','領域ごとの確認範囲',...r.domains.map(d=>d.name+'：'+(quick?(d.valid?(d.reported?'見直したい対応あり':'今回の報告なし'):'未確認'):(d.score===null?'未算出':Math.round(d.score)+'点'))+'（有効 '+d.valid+' / '+d.count+'）'),'','安全確認',...SAFETY_QUESTIONS.map(q=>safetyTitle(q.id)+'：'+safetyReportsText(data.safety[q.id])+'／'+currentRiskLabel(data.safety[q.id])),r.safety.unconfirmed.length?'行動の有無または現在の安全が未確認の項目：'+r.safety.unconfirmed.length+'件。結果は安全確認の代わりにはなりません。':'',quick?'手軽版では現在の危険を追加質問していません。今、危険・けががある場合は、安全確保と支援を優先してください。':'','','③ 強み',...r.strengths.flatMap(s=>{const q=QUESTIONS.find(q=>q.id===s.questionId);return [s.text,'選んだ対応：'+q.options.find(o=>o.id===s.optionId).label];}),r.strengths.length?'':'強みを特定する情報が十分ではありません。強みがないという意味ではありません。','','③ 課題',...r.challenges.flatMap(item=>[item.question.scenario,...selectedLabels(item.question,item.answer,true),quick?'日数は未確認です。':'対象の対応があった日：'+days[item.answer.frequency]])];
  if(!r.challenges.length)parts.push('回答が確定した日常項目では、優先して変える対象行動の情報が十分ではありません。');
  if(r.safety.conflicts.length) parts.push('','安全回答の再確認が必要です',...r.safety.conflicts.map(id=>safetyTitle(id)+'：'+safetyReportsText(data.safety[id])+'。異なる報告をすべて保持しているため、今回の回答を確認してください。'));
  if(r.safety.recent.length||r.safety.urgent.length||r.safety.other.length||r.safety.conflicts.length){
    parts.push('','④ 先に確認したいこと','子どもとあなたの現在の安全を確認し、必要な保護・医療・大人の支援を確保してください。');
    if(r.safety.conflicts.length)parts.push('行為をした人や時期を決めつけず、異なる安全の回答を確認してください。');
    const own=[...new Set([...r.safety.recent,...r.safety.urgent.filter(id=>['recent','past'].includes(data.safety[id]?.status))])];
    own.forEach(id=>{const q=SAFETY_QUESTIONS.find(q=>q.id===id);parts.push(safetyTitle(id)+'：'+cleanText(q.alternative));});
    if(r.safety.other.length||r.safety.conflicts.some(id=>safetyConflicts(data.safety[id]).includes('other')))parts.push('他の人による暴力を、あなた自身の加害として扱うことはありません。子どもとあなたの安全のために、大人の支援を頼ってください。');
    parts.push('虐待の相談・通告：189／子育ての相談：0120-189-783','事件・事故の緊急通報：110／救急：119');
  }
  else if(r.priority){const q=r.priority.question;parts.push('','④ 今後の接し方',cleanText(q.action),cleanText(q.alternative),'次の機会・1週間の振り返り',cleanText(q.goal));}
  else if(r.strengths.length){const strength=r.strengths[0],q=QUESTIONS.find(q=>q.id===strength.questionId);parts.push('','④ 今後の接し方',strength.text,cleanText(q.alternative),'次に同じ場面があったときも、この対応を続けられたか振り返ってみましょう。');}
  else {parts.push('','④ 今後の接し方','答えられる場面や、状況の確認が必要な回答を振り返ってください。');}
  parts.push('','言動ごとの解説');
  for(const q of dailyQuestions(data)) {
    const a=data.answers[q.id];if(!a?.status)continue;
    parts.push('','【'+q.scenario+'】');
    if(a.status!=='answered'){parts.push(statusLabels[a.status]||'未回答');continue;}
    const score=quick?scoreQuickAnswer(q,a):scoreAnswer(q,a),supportive=!concern(q,a),protective=!quick&&a.context==='protective'&&score===0;
    parts.push('選んだ対応：',...selectedLabels(q,a));
    if(score===null)parts.push('状況・頻度の確認が必要なため集計を保留しています。以下は一般的な解説です。');
    else if(protective)parts.push('必要な保護・援助として確認。以下はその範囲を超えた言動の一般的な説明です。');
    else if(score>0)parts.push(quick?'この30日にしたと回答した対応です。日数は未確認です。':'対象の対応があった日：'+days[a.frequency]);
    if(supportive)parts.push('選んだ対応から確認できたこと：',...['A','B'].filter(id=>a.selected.includes(id)&&q.strengths?.[id]).map(id=>q.strengths[id]));
    else parts.push('この対応を見直したい理由：'+cleanText(q.why),'研究で報告されていること：'+cleanText(q.evidence));
    parts.push('状況による違い：'+cleanText(q.context),'次に試せる言葉・行動：'+cleanText(q.alternative),'根拠と、分かっていないこと：'+cleanText(q.limits),...q.refs.map(id=>referenceMap[id].author+'／'+referenceMap[id].kind+'／'+referenceMap[id].title+' '+referenceMap[id].url));
  }
  parts.push('','安全確認の解説','以下は一般的な説明です。未回答や他者の行為を、あなた自身の行為と判断するものではありません。');
  for(const q of SAFETY_QUESTIONS)parts.push('','【'+safetyTitle(q.id)+'】','あなたの回答：'+safetyReportsText(data.safety[q.id]),currentRiskLabel(data.safety[q.id]),'子どもにとって問題となる点：'+cleanText(q.why),'研究・公的資料：'+cleanText(q.evidence),'状況による違い：'+cleanText(q.context),'次に確認したい行動・支援：'+cleanText(q.alternative),'根拠と、分かっていないこと：'+cleanText(q.limits),...q.refs.map(id=>referenceMap[id].author+'／'+referenceMap[id].kind+'／'+referenceMap[id].title+' '+referenceMap[id].url));
  parts.push('','回答の再確認が必要な場合や不明の項目は、0点として解釈しないでください。','内容確認：'+META.reviewDate);
  return parts.filter(x=>x!==undefined).join('\n');
}
function downloadReport() {
  const blob=new Blob(['\uFEFF'+textReport()],{type:'text/plain;charset=utf-8'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='セルフ毒親チェック_振り返り結果_'+new Date().toISOString().slice(0,10)+'.txt';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  toast('結果のテキストを保存しました。共有する場合は、内容をご確認ください。');
}
document.addEventListener('change',e=>{
  const target=e.target;
  if(target.name==='check-mode'){state=switchMode(state,target.value);persist();render();return;}
  if(target.id==='child-age'){
    const value=Number(target.value),age=Number.isInteger(value)&&value>=6&&value<=17?value:null;
    if(age===state.profile.age)return;
    if(hasAnyResponses()){
      target.value=state.profile.age===null?'':String(state.profile.age);
      showDialog('年齢を変更して、回答し直しますか？','対象の子どもや年齢が変わると、以前の回答をそのまま使えません。両方のチェックの回答を消し、選んだ年齢で最初から回答します。',()=>{
        const mode=state.mode,saveEnabled=state.saveEnabled;state=freshState(mode);state.profile.age=age;state.saveEnabled=saveEnabled;persist();render();
      },'年齢を変更して回答し直す');
      return;
    }
    state.profile.age=age;persist();return;
  }
  if(['save-setup','save-quiz','save-privacy'].includes(target.id)){toggleSave(target.checked);render({focusId:target.id});return;}
  if(screen!=='quiz')return;
  const q=activeQuestions()[state.position];
  if(target.name==='response-option'){
    const a=getAnswer(q); let selected=a.status==='answered'?[...a.selected]:[];
    selected=target.checked?[...new Set([...selected,target.value])]:selected.filter(x=>x!==target.value);
    const had=concern(q,a); const now=selected.some(id=>q.concernOptions.includes(id));
    const concernsChanged=q.concernOptions.some(id=>list(a.selected).includes(id)!==selected.includes(id));
    const updated={...a,status:selected.length?'answered':null,selected};
    if(!now){updated.frequency=0;updated.context=null;updated.contextChecks=[];}
    else if(!had||concernsChanged){updated.frequency=null;updated.context=isQuick()||contextualIds.has(q.id)?null:'review';updated.contextChecks=[];}
    if(updated.context==='protective'&&!canProtect(q,updated)){updated.context=null;updated.contextChecks=[];updated.frequency=null;}
    state.answers[q.id]=updated;
  } else if(target.name==='frequency'){state.answers[q.id]={...getAnswer(q),frequency:Number(target.value)};}
  else if(target.name==='context'){state.answers[q.id]={...getAnswer(q),context:target.value,contextChecks:[],frequency:null};}
  else if(target.name==='context-check'){
    const a=getAnswer(q); const checks=new Set(a.contextChecks);target.checked?checks.add(target.value):checks.delete(target.value);
    state.answers[q.id]={...a,contextChecks:[...checks]};
  } else if(target.name==='safety-status'){state.safety[q.id]={status:target.value,currentRisk:null};}
  else if(target.name==='current-risk'){state.safety[q.id]={...state.safety[q.id],currentRisk:target.value};}
  else return;
  recordResponseChange();formError='';persist();render({focusId:target.id});
});
document.addEventListener('input',e=>{
  if(e.target.id!=='source-search')return;
  const query=e.target.value.trim().toLowerCase();let count=0;
  document.querySelectorAll('.source-card').forEach(card=>{const show=card.dataset.search.includes(query);card.hidden=!show;if(show)count++;});
  $('source-empty').hidden=count>0;
});
document.addEventListener('click',e=>{
  const el=e.target.closest('[data-action]');if(!el||el.disabled)return;
  const action=el.dataset.action;
  if(action==='home'){sampleMode=false;navigate('home');}
  else if(action==='choose-mode'){if(screen!=='home')navigate('home');$('check-modes')?.scrollIntoView({behavior:'smooth',block:'start'});$('mode-title')?.focus({preventScroll:true});}
  else if(action==='choose-check'){chooseCheck(el.dataset.mode);}
  else if(action==='upgrade'){upgrade();}
  else if(action==='start'){sampleMode=false;navigate('setup');}
  else if(action==='resume'){sampleMode=false;if(state.position===activeQuestions().length-1&&questionValid(activeQuestions()[state.position])){const pending=activeQuestions().findIndex(q=>!questionValid(q));if(pending>=0)state.position=pending;}persist();navigate(state.profile.age?'quiz':'setup');}
  else if(action==='begin')begin();
  else if(action==='sample'){sampleMode=true;previousScreen=screen;navigate('results');}
  else if(action==='exit-sample'){sampleMode=false;navigate(hasResponses()?'quiz':'home');}
  else if(action==='exit-sample-start'){sampleMode=false;navigate(hasResponses()?'quiz':'setup');}
  else if(action==='results'){sampleMode=false;if(!state.profile.age){navigate('setup');return;}navigate('results');}
  else if(action==='return'){navigate(previousScreen||'home');}
  else if(['sources','about','privacy','support'].includes(action)){if(!['sources','about','privacy','support'].includes(screen))previousScreen=screen;navigate(action);}
  else if(action==='next')next();
  else if(action==='previous'){state.position=Math.max(0,state.position-1);persist();navigate('quiz');}
  else if(action==='jump'){state.position=Math.max(0,Math.min(activeQuestions().length-1,Number(el.dataset.index)));persist();navigate('quiz');}
  else if(action==='answer-status'){const q=activeQuestions()[state.position];state.answers[q.id]={...emptyAnswer(),status:el.dataset.status};recordResponseChange();persist();formError='';render();}
  else if(action==='confirm-safety'){const q=activeQuestions()[state.position];if(!isSafety(q))return;state.safety[q.id]={status:el.dataset.status,currentRisk:null};recordResponseChange();persist();formError='';render();}
  else if(action==='skip-next'){const q=activeQuestions()[state.position];if(isSafety(q))state.safety[q.id]={status:'skip',currentRisk:null};else state.answers[q.id]={...emptyAnswer(),status:'skip'};recordResponseChange();next();}
  else if(action==='edit-question'){sampleMode=false;state.position=Math.max(0,activeQuestions().findIndex(q=>q.id===el.dataset.id));persist();navigate('quiz');}
  else if(action==='open-detail'){const detail=$('detail-'+el.dataset.id);if(detail){detail.open=true;detail.scrollIntoView({behavior:'smooth',block:'start'});detail.querySelector('summary').focus();}}
  else if(action==='restart'||action==='delete-data'){showDialog(action==='restart'?'最初からやり直しますか？':'回答をすべて削除しますか？','両方のチェックの回答と、このアプリが端末内に保存した回答を削除します。ダウンロードした結果ファイルは削除されません。',()=>{const mode=action==='restart'?state.mode:'quick';clearStorage();state=freshState(mode);sampleMode=false;navigate(action==='restart'?'setup':'home');toast('回答を削除しました。');},action==='restart'?'削除してやり直す':'回答を削除する');}
  else if(action==='print'){window.print();}
  else if(action==='download'){downloadReport();}
});
let printDetails=[];
window.addEventListener('beforeprint',()=>{
  if(screen!=='results'||printDetails.length)return;
  printDetails=[...document.querySelectorAll('#results-view details')].map(detail=>({detail,open:detail.open}));
  printDetails.forEach(({detail})=>{detail.open=true;});
});
window.addEventListener('afterprint',()=>{
  printDetails.forEach(({detail,open})=>{detail.open=open;});printDetails=[];
});
render();

