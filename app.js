'use strict';
const $ = id => document.getElementById(id);
const STORAGE_KEY = 'workmood-product-v2';
const TYPE_LABELS = { A: 'A · 我可以做', B: 'B · 需要溝通', C: 'C · 需要支持' };
const apiBase = String(window.WORKMOOD_CONFIG?.apiBase || '').replace(/\/$/, '');
const state = { messages: [], mood: '', mode: 'demo', config: null, busy: false, generation: 0, reflection: null, savedId: null, filter: 'all', records: [], controller: null, retryIntent: 'chat' };
try {
  const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  if (!Array.isArray(value) || value.some(r => !r || typeof r.id !== 'string' || !['A', 'B', 'C'].includes(r.problem_type))) throw Error();
  state.records = value;
} catch { notify('無法讀取本機紀錄。請先檢查瀏覽器儲存權限。'); }

function notify(message) {
  $('toast').textContent = message; $('toast').hidden = false;
  clearTimeout(notify.timer); notify.timer = setTimeout(() => $('toast').hidden = true, 3800);
}
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function ask(title, text) {
  $('dialogTitle').textContent = title; $('dialogText').textContent = text;
  const dialog = $('confirmDialog'); dialog.returnValue = 'cancel'; dialog.showModal();
  return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }));
}
function showView(view) {
  for (const name of ['chat', 'history', 'settings']) $(name + 'View').hidden = name !== view;
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $('pageTitle').textContent = { chat: '整理一下', history: '我的紀錄', settings: '設定與隱私' }[view];
  $('newChat').hidden = view !== 'chat';
  if (view === 'history') renderHistory();
}
document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => showView(b.dataset.view));
function setBusy(busy) {
  state.busy = busy;
  ['send', 'organize', 'sample', 'messageInput', 'engine'].forEach(id => $(id).disabled = busy);
  document.querySelectorAll('[data-mood]').forEach(b => b.disabled = busy);
  $('send').textContent = busy ? '…' : '↑';
}
function renderMessages() {
  const root = $('messages'); root.replaceChildren();
  $('welcome').hidden = state.messages.length > 0;
  state.messages.forEach(message => {
    const row = element('article', undefined, 'message ' + message.role);
    if (message.role === 'assistant') row.append(element('span', 'w', 'avatar'));
    const body = element('div', undefined, 'message-body');
    body.append(element('p', message.content));
    if (message.role === 'assistant' && message.source) body.append(element('small', message.source));
    row.append(body); root.append(row);
  });
  if (state.busy) { const row = element('div', undefined, 'message assistant'); row.append(element('span', 'w', 'avatar'), element('span', '正在整理…', 'typing')); root.append(row); }
  $('organize').hidden = !state.messages.some(m => m.role === 'user');
  $('conversationScroll').scrollTop = $('conversationScroll').scrollHeight;
}
function clearReflection() {
  state.reflection = null; state.savedId = null; $('reflectionPanel').hidden = true;
  $('chatLayout').classList.remove('has-reflection'); $('confirmed').checked = false;
}
function resetChat() {
  state.generation++; state.controller?.abort(); state.messages = []; state.mood = '';
  $('messageInput').value = ''; $('consent').checked = false; $('chatError').hidden = true;
  $('moodTag').textContent = '慢慢說，我在。';
  document.querySelectorAll('[data-mood]').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); });
  clearReflection(); setBusy(false); renderMessages();
}
$('newChat').onclick = async () => {
  if (state.messages.length && !await ask('開始新對話？', '目前的對話與未保存整理將清除；已保存的紀錄會保留。')) return;
  resetChat(); $('messageInput').focus();
};
document.querySelectorAll('[data-mood]').forEach(button => button.onclick = () => {
  state.mood = state.mood === button.dataset.mood ? '' : button.dataset.mood;
  document.querySelectorAll('[data-mood]').forEach(b => { const on = b.dataset.mood === state.mood; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
  $('moodTag').textContent = state.mood ? '此刻 · ' + state.mood : '慢慢說，我在。'; $('messageInput').focus();
});
$('sample').onclick = () => {
  $('messageInput').value = '主管突然要我明天交原本下週的報告，手上還有兩件急件。我很焦慮，但不知道怎麼回。';
  $('messageInput').focus();
};

function demoReply(messages, mood, intent) {
  const users = messages.filter(m => m.role === 'user').map(m => m.content).filter(text => text !== '請根據目前的對話，幫我整理成下一步。');
  const text = users.join('\n');
  if (/自殺|自杀|不想活|結束生命|结束生命|傷害自己|伤害自己|想死|kill myself|suicid/i.test(text)) {
    return { reply: '先把你的安全放在第一位。如果有立即危險，請聯絡當地緊急服務，或請信任的人陪伴你尋求協助。', phase: 'support', reflection: { event_summary: users[0], emotion: mood || '需要支持', need: '安全與即時支持', problem_type: 'C', next_action: '請信任的人陪伴你，並尋求當地的即時協助。', communication_script: '', uncertainty: '這是關鍵字支持提示，無法判斷實際風險。' }, source: '規則示範' };
  }
  const type = /長期|长期|每週.{0,12}加班|每周.{0,12}加班|兩個月|两个月|霸凌|騷擾|骚扰|威脅|威胁/.test(text) ? 'C' : /主管|期限|急件|分工|同事|需求|報告|报告|溝通|沟通/.test(text) ? 'B' : 'A';
  if (users.length === 1 && intent !== 'summarize') {
    const question = { A: '你現在最想先調整的，是工作安排，還是休息的空間？', B: '這件事裡，你最希望對方協助確認什麼？例如優先順序、期限，或分工。', C: '你目前有可以信任、一起討論這個情況的支持窗口嗎？' }[type];
    return { reply: question, phase: 'clarify', reflection: null, source: '規則示範' };
  }
  if (text.length < 12 && intent === 'summarize') return { reply: '可以多說一點具體發生的事嗎？我想先了解情境，再一起找下一步。', phase: 'clarify', reflection: null, source: '規則示範' };
  const emotion = mood || (text.match(/焦慮|疲憊|委屈|無力|煩躁|平靜|開心/) || ['待你確認'])[0];
  const need = users.length > 1 ? users[users.length - 1] : { A: '保留可以調整或休息的空間', B: '確認優先順序與可調整範圍', C: '獲得支持，討論工作安排的改善方式' }[type];
  const action = { A: '選一個你可以調整的小安排，寫下今天先做的一件事。', B: '列出目前任務與期限，再與相關人員確認優先順序。', C: '記下具體事件與時間，再與可信任的支持窗口討論可行資源。' }[type];
  return { reply: '我把目前的內容整理成一張卡片。先看看是否符合你的情況；不符合的地方可以修改，也可以繼續告訴我。', phase: 'ready', reflection: { event_summary: users[0], emotion, need, problem_type: type, next_action: action, communication_script: type === 'B' ? '目前有幾項工作需要同時處理，我希望先確認優先順序與可調整範圍。能否一起討論各項任務的期限與安排？' : '', uncertainty: '規則示範的暫時分類，請依你的實際情況修改。' }, source: '規則示範' };
}
function showReflection(data, phase, source) {
  clearReflection(); if (!data) return;
  state.reflection = { ...data, phase, source };
  for (const [id, field] of Object.entries({ eventSummary: 'event_summary', emotion: 'emotion', problemType: 'problem_type', need: 'need', nextAction: 'next_action', communication: 'communication_script' })) $(id).value = data[field];
  $('reflectionPanel').hidden = false; $('chatLayout').classList.add('has-reflection');
  $('inferenceNote').textContent = data.uncertainty || '這是可能的理解，你可以修改。';
  $('safetyNote').hidden = phase !== 'support'; $('problemType').disabled = phase === 'support';
  $('savedNote').hidden = true; $('saveReflection').disabled = false; $('saveReflection').textContent = '確認並保存 ↗';
  updateType();
}
function updateType() {
  const type = $('problemType').value;
  $('typeBadge').textContent = TYPE_LABELS[type]; $('typeBadge').dataset.type = type;
  $('scriptBox').hidden = type !== 'B' || state.reflection?.phase === 'support';
}
function markEdited() {
  $('confirmed').checked = false; $('savedNote').hidden = true; $('saveReflection').disabled = false;
  $('saveReflection').textContent = state.savedId ? '確認並更新 ↗' : '確認並保存 ↗';
}
$('reflectionForm').addEventListener('input', event => { if (event.target.id !== 'confirmed') markEdited(); });
$('problemType').onchange = () => { updateType(); markEdited(); notify('分類已變更，請一起確認下一步。'); };
async function sendMessage(intent = 'chat') {
  if (state.busy) return;
  const content = intent === 'summarize' ? '請根據目前的對話，幫我整理成下一步。' : $('messageInput').value.trim();
  if (!content) { $('messageInput').focus(); return; }
  if (state.messages.length >= 24) return notify('這次已聊了 12 輪。請先保存整理，再開始新對話。');
  if (state.mode === 'live' && !$('consent').checked) return notify('請先同意傳送本次對話。');
  if (state.mode === 'live' && state.config?.requires_code && !$('accessCode').value.trim()) { showView('settings'); $('accessCode').focus(); return notify('請先輸入試用碼。'); }
  const generation = state.generation;
  state.messages.push({ role: 'user', content }); $('messageInput').value = ''; $('chatError').hidden = true;
  clearReflection(); setBusy(true); renderMessages();
  try {
    let result;
    if (state.mode === 'live') {
      const controller = new AbortController(); state.controller = controller;
      const timeout = setTimeout(() => controller.abort(), 65000);
      try {
        const response = await fetch(apiBase + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-WorkMood-Code': $('accessCode').value.trim() }, body: JSON.stringify({ messages: state.messages.map(({ role, content }) => ({ role, content })), mood: state.mood, intent, consent: true }), signal: controller.signal });
        result = await response.json();
        if (!response.ok) throw Error(result.error || '暫時無法連線，請稍後重試。');
      } finally { clearTimeout(timeout); }
    } else result = demoReply(state.messages, state.mood, intent);
    if (generation !== state.generation) return;
    if (typeof result.reply !== 'string' || !result.reply.trim() || !['clarify', 'ready', 'support'].includes(result.phase)) throw Error('回覆格式異常，請重試。');
    if (result.phase !== 'clarify' && (!result.reflection || !['event_summary','emotion','need','problem_type','next_action','communication_script','uncertainty'].every(key => typeof result.reflection[key] === 'string') || !TYPE_LABELS[result.reflection.problem_type])) throw Error('整理內容不完整，請重試。');
    showReflection(result.reflection, result.phase, result.source);
    state.messages.push({ role: 'assistant', content: result.reply, source: result.source });
  } catch (error) {
    if (generation !== state.generation) return;
    state.messages.pop(); $('messageInput').value = content;
    state.retryIntent = intent;
    $('errorText').textContent = error.name === 'AbortError' ? '連線逾時，內容還在，可以再試一次。' : error.message;
    $('chatError').hidden = false;
  } finally {
    if (generation === state.generation) { setBusy(false); renderMessages(); $('messageInput').focus(); }
  }
}
$('chatForm').onsubmit = e => { e.preventDefault(); sendMessage(); };
$('messageInput').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendMessage(); } };
$('organize').onclick = () => sendMessage('summarize'); $('retry').onclick = () => sendMessage(state.retryIntent);
$('copyScript').onclick = async () => { try { await navigator.clipboard.writeText($('communication').value); notify('已複製。請確認內容後再使用。'); } catch { $('communication').focus(); $('communication').select(); notify('已選取草稿，請按 Ctrl+C 複製。'); } };
function storeRecords(next) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); state.records = next; return true; }
  catch { notify('保存失敗。請檢查瀏覽器儲存權限或容量。'); return false; }
}
$('reflectionForm').onsubmit = e => {
  e.preventDefault(); if (!state.reflection) return;
  if (!$('confirmed').checked) return notify('請先確認這份整理符合你的情況。');
  const fields = { event_summary: 'eventSummary', emotion: 'emotion', need: 'need', next_action: 'nextAction' };
  if (Object.values(fields).some(id => !$(id).value.trim())) return notify('請填寫事件、感受、需求與下一步。');
  const old = state.records.find(r => r.id === state.savedId);
  const record = { id: state.savedId || String(Date.now()) + '-' + Math.random().toString(16).slice(2), created_at: old?.created_at || new Date().toISOString(), updated_at: new Date().toISOString(), problem_type: state.reflection.phase === 'support' ? 'C' : $('problemType').value, source: state.reflection.source, done: old?.done || false, confirmed: true };
  for (const [key, id] of Object.entries(fields)) record[key] = $(id).value.trim();
  record.communication_script = record.problem_type === 'B' ? $('communication').value.trim() : '';
  const next = state.savedId ? state.records.map(r => r.id === state.savedId ? record : r) : [record, ...state.records];
  if (storeRecords(next)) { state.savedId = record.id; $('savedNote').hidden = false; $('saveReflection').disabled = true; $('saveReflection').textContent = '已保存 ✓'; notify('已保存到我的紀錄。'); }
};
function mostCommon(values) { const counts = new Map(); values.forEach(v => counts.set(v, (counts.get(v) || 0) + 1)); return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]; }
function renderHistory() {
  const insights = $('insights'); insights.replaceChildren();
  const common = mostCommon(state.records.map(r => r.emotion));
  for (const [value, label, detail] of [[state.records.length, '已確認的整理', '只有確認後才保存'], [state.records.filter(r => r.done).length, '已完成的行動', '依你的回顧標記'], [common?.[0] || '—', '最常記錄的感受', common ? common[1] + ' 次 · 不代表診斷' : '累積紀錄後顯示']]) { const box = element('div', undefined, 'insight'); box.append(element('strong', String(value)), element('span', label), element('p', detail)); insights.append(box); }
  const root = $('historyList'); root.replaceChildren();
  const records = state.records.filter(r => state.filter === 'all' || (state.filter === 'done' ? r.done : !r.done));
  if (!records.length) { const empty = element('div', undefined, 'empty-history'); empty.append(element('span', '◌'), element('h2', state.records.length ? '這裡暫時沒有紀錄' : '從一個小步驟開始'), element('p', state.records.length ? '試試其他篩選條件。' : '完成對話並確認整理，就會留在這裡。')); const button = element('button', '開始整理', 'primary'); button.onclick = () => showView('chat'); empty.append(button); root.append(empty); }
  records.forEach(record => {
    const card = element('article', undefined, 'history-card');
    const meta = element('div', undefined, 'record-meta'); meta.append(element('span', new Date(record.created_at).toLocaleDateString('zh-TW') + ' · ' + record.source), element('span', TYPE_LABELS[record.problem_type]));
    card.append(meta, element('h2', record.emotion + ' · ' + record.need), element('p', record.next_action));
    const detail = element('details', undefined, 'record-detail'); detail.append(element('summary', '查看完整整理'), element('p', record.event_summary));
    if (record.communication_script) detail.append(element('p', '溝通草稿：' + record.communication_script)); card.append(detail);
    const actions = element('div', undefined, 'record-actions'); const done = element('button', record.done ? '✓ 已完成' : '標記完成', 'outline');
    done.onclick = () => { if (storeRecords(state.records.map(r => r.id === record.id ? { ...r, done: !r.done } : r))) renderHistory(); };
    const remove = element('button', '刪除', 'text-danger');
    remove.onclick = async () => { if (await ask('刪除這份整理？', '刪除後無法復原。') && storeRecords(state.records.filter(r => r.id !== record.id))) { if (state.savedId === record.id) { state.savedId = null; markEdited(); } renderHistory(); } };
    actions.append(done, remove); card.append(actions); root.append(card);
  });
}
document.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { state.filter = b.dataset.filter; document.querySelectorAll('[data-filter]').forEach(n => n.classList.toggle('active', n === b)); renderHistory(); });
$('exportRecords').onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(state.records, null, 2)], { type: 'application/json;charset=utf-8' })); const a = element('a'); a.href = url; a.download = 'workmood-records.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('deleteAll').onclick = async () => { if (await ask('刪除全部紀錄？', '此裝置上的 WorkMood 紀錄將清除。已匯出的檔案不會刪除。') && storeRecords([])) { state.savedId = null; markEdited(); notify('已刪除全部紀錄。'); } };
function updateModeUI() {
  $('engine').value = state.mode; $('mode').textContent = state.mode === 'live' ? 'AI 對話' : '展示模式';
  $('mode').classList.toggle('live', state.mode === 'live'); $('consentRow').hidden = state.mode !== 'live';
  $('modeHint').textContent = state.mode === 'live' ? 'AI 的理解可能有誤，請確認後再採用。' : '展示模式使用規則回覆，尚未連接 AI。';
  $('accessRow').hidden = !state.config?.requires_code;
}
$('engine').onchange = async () => {
  const next = $('engine').value;
  if (next === 'live' && !state.config?.enabled) { $('engine').value = state.mode; notify('尚未連接 AI。請依 README 設定後端、模型與金鑰。'); return; }
  if (state.messages.length && !await ask('切換對話模式？', '切換後將開始新對話，已保存的紀錄會保留。')) { $('engine').value = state.mode; return; }
  resetChat(); state.mode = next; updateModeUI();
};
async function connect() {
  if (location.protocol === 'file:') return;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(apiBase + '/api/config', { signal: controller.signal });
    if (!response.ok) return;
    state.config = await response.json();
    if (state.config.enabled) { $('connectionInfo').textContent = '已設定 · ' + state.config.model; if (!state.messages.length && !state.busy) state.mode = 'live'; }
    else $('connectionInfo').textContent = state.config.message || '後端已連接，模型與金鑰尚未設定';
    updateModeUI();
  } catch { $('connectionInfo').textContent = '未連接 AI 後端'; }
  finally { clearTimeout(timer); }
}
updateModeUI(); connect();
