const $ = id => document.getElementById(id);
let csrf = '', revision = 0, definitions = [], timer;
function notice(message, error = false) { $('notice').textContent = message; $('notice').classList.toggle('error', error); $('notice').hidden = !message; }
async function api(path, data) {
  const response = await fetch(`/api/${path}`, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, ...(data === undefined ? {} : { method: 'POST', body: JSON.stringify(data) }) });
  const body = await response.json();
  if (!response.ok) { if (response.status === 401) showLogin(true); throw new Error(body.message || '요청을 처리하지 못했습니다.'); }
  return body;
}
function showLogin(configured) {
  clearInterval(timer); $('dashboard').hidden = true; $('logout').hidden = true;
  $('login-panel').hidden = !configured; $('setup-panel').hidden = configured;
}
function list(id, items, format, empty) {
  $(id).replaceChildren();
  for (const item of items.length ? items : [null]) { const li = document.createElement('li'); li.textContent = item ? format(item) : empty; $(id).append(li); }
}
function render(data) {
  revision = data.revision; definitions = data.fields;
  $('revision').textContent = `설정 버전 ${revision}`;
  $('ai-fields').replaceChildren(); $('limit-fields').replaceChildren();
  for (const f of definitions) {
    const label = document.createElement('label'); label.textContent = f.label;
    const input = document.createElement(['boolean', 'provider'].includes(f.type) ? 'select' : 'input');
    input.name = f.key; input.id = `field-${f.key}`;
    if (input.tagName === 'SELECT') {
      for (const [value, text] of f.type === 'boolean' ? [['true', '사용'], ['false', '미사용']] : [['openai', 'OpenAI (GPT)']]) { const option = document.createElement('option'); option.value = value; option.textContent = text; input.append(option); }
    } else {
      input.type = ['number', 'decimal', 'seconds'].includes(f.type) ? 'number' : f.type === 'url' ? 'url' : 'text';
      if (input.type === 'number') { input.min = f.min; input.max = f.max; input.step = f.type === 'decimal' ? 'any' : '1'; input.required = true; }
      else input.maxLength = 500;
    }
    input.value = String(data.values[f.key]); label.append(input); $(f.section === 'ai' ? 'ai-fields' : 'limit-fields').append(label);
  }
  $('api-key').value = ''; $('clear-key').checked = false;
  $('key-status').textContent = data.apiKeyPresent ? 'API 키가 등록되어 있습니다.' : '등록된 API 키가 없습니다.';
  list('audit', data.audit, x => `${new Date(x.at).toLocaleString()} · ${x.actor} · ${x.changed.join(', ') || '설정 확인 저장'}`, '변경 기록이 없습니다.');
}
async function overview() {
  try {
    const data = await api('overview');
    $('running').textContent = data.running; $('queued').textContent = data.queued;
    $('requests').textContent = data.ai.requests; $('cost').textContent = data.ai.costUsd == null ? '확인 필요' : `$${data.ai.costUsd.toFixed(5)}`;
    list('failures', data.recentFailures, x => `${new Date(x.at).toLocaleString()} · ${x.stage} · ${x.code}`, '최근 실패가 없습니다.');
  } catch (e) { notice(e.message, true); }
}
async function dashboard() {
  render(await api('settings')); $('dashboard').hidden = false; $('logout').hidden = false;
  $('login-panel').hidden = true; $('setup-panel').hidden = true;
  await overview(); clearInterval(timer); timer = setInterval(overview, 10000);
}
$('login-form').addEventListener('submit', async e => {
  e.preventDefault(); const button = e.target.querySelector('button'); button.disabled = true;
  try { const data = await api('login', { username: e.target.elements.username.value, password: e.target.elements.password.value }); e.target.elements.password.value = ''; csrf = data.csrf; notice(''); await dashboard(); }
  catch (error) { notice(error.message, true); } finally { button.disabled = false; }
});
$('settings-form').addEventListener('submit', async e => {
  e.preventDefault(); $('save').disabled = true;
  try {
    const values = {};
    for (const f of definitions) { const raw = $(`field-${f.key}`).value; values[f.key] = f.type === 'boolean' ? raw === 'true' : ['number', 'decimal', 'seconds'].includes(f.type) ? Number(raw) : raw; }
    const result = await api('settings', { revision, values, apiKey: $('api-key').value, clearApiKey: $('clear-key').checked });
    render(result); notice('저장했습니다. 새로 시작하는 작업부터 적용됩니다.'); await overview();
  } catch (error) { notice(error.message, true); } finally { $('save').disabled = false; }
});
$('logout').addEventListener('click', async () => { try { await api('logout', {}); csrf = ''; showLogin(true); notice('로그아웃했습니다.'); } catch (e) { notice(e.message, true); } });
(async () => { try { const session = await api('session'); csrf = session.csrf || ''; if (session.authenticated) await dashboard(); else showLogin(session.configured); } catch (e) { notice(e.message, true); } })();
