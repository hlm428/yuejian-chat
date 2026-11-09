/**
 * 月见公寓聊天页 · 主逻辑
 * EXAONE 免费接口（OpenAI 兼容）：https://api.exaone.ai/v1，模型 k-exaone-2.5-32b
 * Key 只存浏览器 localStorage；聊天记录/好感度也在本地。
 */

const API_MODEL = 'k-exaone-2.5-32b';
/** 默认 EXAONE 官方接口；EXAONE 禁止浏览器直连（CORS），可到设置里改成本地代理 / 兼容网关 */
const API_BASE_DEFAULT = 'https://api.exaone.ai/v1';

function apiBase() {
  return (localStorage.getItem('yuechat-base') || API_BASE_DEFAULT).replace(/\/$/, '');
}

const store = {
  key: 'yuechat-key',
  msgs: (id) => `yuechat-msgs-${id}`,
  aff: (id) => `yuechat-aff-${id}`,
  greet: (id) => `yuechat-greet-${id}`,
  milestone: (id) => `yuechat-milestone-${id}`,
};

/** 好感度里程碑阈值 */
const AFF_STEPS = [20, 50, 80];

/** 阶段语气（拼进系统提示词，20/50/80 各升一档） */
function affinityStage(aff) {
  if (aff >= 80) return 3;
  if (aff >= 50) return 2;
  if (aff >= 20) return 1;
  return 0;
}

const STAGE_TEXT = [
  '【好感度 · 初识】你们刚认识不久，礼貌客气，带一点好奇。',
  '【好感度 · 朋友】你们熟起来了她会主动找话题，语气放松亲近，偶尔撒娇或开小玩笑。',
  '【好感度 · 暧昧】她说话开始带上依赖和暗示，会主动关心你的日常，言语间若有若无地靠近。',
  '【好感度 · 恋人】她把你当最亲近的人，语气直接温柔，占有欲/依赖心按她的性格自然流露（不夸张）。',
];

function $id(name) {
  return document.getElementById(name);
}

function loadJSON(k, fallback) {
  try {
    const raw = localStorage.getItem(k);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(k, v) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

/** 应用当前女主配色（body class 切换） */
function applyTheme(ch) {
  document.body.className = `theme-${ch.color}`;
}

let current = null; // 当前女主
let busy = false; // 等待回复中

/* ---------- 选人界面 ---------- */

function renderPicker() {
  current = null;
  applyTheme({ color: 'default' });
  $id('picker').style.display = '';
  $id('chat').style.display = 'none';
  const grid = $id('charGrid');
  grid.innerHTML = '';
  for (const ch of CHARACTERS) {
    const aff = loadJSON(store.aff(ch.id), 0);
    const card = document.createElement('button');
    card.className = 'charCard';
    card.innerHTML = `
      <img src="${ch.art}" alt="${ch.name}立绘" />
      <div class="charInfo">
        <div class="charName">${ch.name}</div>
        <div class="charRoom">${ch.room} · ${ch.age}</div>
        <div class="charIntro">${ch.intro}</div>
        <div class="charAff">好感度 <b>${aff}</b>${aff >= 80 ? ' · 恋人' : aff >= 50 ? ' · 暧昧' : aff >= 20 ? ' · 朋友' : ''}</div>
      </div>`;
    card.onclick = () => openChat(ch);
    grid.appendChild(card);
  }
}

/* ---------- 聊天界面 ---------- */

function openChat(ch) {
  current = ch;
  busy = false;
  applyTheme(ch);
  $id('picker').style.display = 'none';
  $id('chat').style.display = '';
  $id('chatAvatar').src = ch.avatar;
  $id('chatName').textContent = ch.name;
  $id('chatRoom').textContent = `${ch.room} · ${ch.job}`;
  renderAffinity();
  renderMessages();
  renderOpeners();
  maybeDailyGreeting(ch);
  $id('input').focus();
}

function backToPicker() {
  renderPicker();
}

function renderAffinity() {
  const aff = loadJSON(store.aff(current.id), 0);
  $id('affBar').style.width = `${Math.min(100, aff)}%`;
  $id('affText').textContent = `好感度 ${aff}${aff >= 80 ? ' · 恋人' : aff >= 50 ? ' · 暧昧' : aff >= 20 ? ' · 朋友' : ''}`;
}

function messages() {
  return loadJSON(store.msgs(current.id), []);
}

function renderMessages() {
  const wrap = $id('messages');
  wrap.innerHTML = '';
  for (const m of messages()) {
    appendBubble(m.role, m.content, false);
  }
  wrap.scrollTop = wrap.scrollHeight;
}

function appendBubble(role, content, scroll = true, typing = false) {
  const wrap = $id('messages');
  const div = document.createElement('div');
  div.className = `bubble ${role === 'user' ? 'mine' : 'hers'}`;
  if (typing) div.classList.add('typing');
  div.textContent = content;
  wrap.appendChild(div);
  if (scroll) wrap.scrollTop = wrap.scrollHeight;
  return div;
}

function pushMsg(role, content) {
  const list = messages();
  list.push({ role, content, at: Date.now() });
  saveJSON(store.msgs(current.id), list);
}

/** 每天第一次打开：她先打招呼（按本地时间挑问候） */
function maybeDailyGreeting(ch) {
  const today = new Date().toISOString().slice(0, 10);
  if (loadJSON(store.greet(ch.id), null) === today) return;
  const h = new Date().getHours();
  const slot = h < 6 ? 'lateNight' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : h < 23 ? 'evening' : 'lateNight';
  const text = ch.greetings[slot];
  pushMsg('assistant', text);
  appendBubble('assistant', text);
  saveJSON(store.greet(ch.id), today);
}

/** 预设开场白（每女主 3 条，点了就发） */
function renderOpeners() {
  const bar = $id('openers');
  bar.innerHTML = '';
  for (const t of current.openers) {
    const b = document.createElement('button');
    b.className = 'opener';
    b.textContent = t;
    b.onclick = () => {
      if (busy) return;
      $id('input').value = t;
      $id('openers').style.display = 'none';
      send();
    };
    bar.appendChild(b);
  }
  $id('openers').style.display = messages().length <= 1 ? '' : 'none';
}

/* ---------- 好感度 ---------- */

function bumpAffinity() {
  const aff = loadJSON(store.aff(current.id), 0) + 1;
  saveJSON(store.aff(current.id), aff);
  renderAffinity();
  // 跨过里程碑：解锁一句专属台词（每档只触发一次）
  for (const step of AFF_STEPS) {
    if (aff === step) {
      const hit = loadJSON(store.milestone(current.id), []);
      if (!hit.includes(step)) {
        hit.push(step);
        saveJSON(store.milestone(current.id), hit);
        const text = current.milestones[step];
        pushMsg('assistant', text);
        appendBubble('assistant', text);
      }
    }
  }
}

/* ---------- 发送与回复 ---------- */

function buildSystemPrompt() {
  const aff = loadJSON(store.aff(current.id), 0);
  return [
    current.system,
    STAGE_TEXT[affinityStage(aff)],
    `当前好感度：${aff}。用简体中文回复（偶尔一句日语短句点缀也可以，但要给中文语境）。`,
  ].join('\n');
}

async function send() {
  if (busy || !current) return;
  const input = $id('input');
  const text = input.value.trim();
  if (!text) return;
  const apiKey = localStorage.getItem(store.key) || '';
  if (!apiKey.trim()) {
    openSettings('先填 EXAONE API Key 才能聊天哦——点右上角「设置」');
    return;
  }
  input.value = '';
  pushMsg('user', text);
  appendBubble('user', text);
  bumpAffinity();
  $id('openers').style.display = 'none';

  busy = true;
  // 「正在输入…」提示
  const typingBubble = appendBubble('assistant', '正在输入…', true, true);
  const history = messages()
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content }));
  try {
    const reply = await callExaone(apiKey, history, apiBase());
    // 打字机效果：逐字出，不一下子全蹦
    typingBubble.remove();
    const bubble = appendBubble('assistant', '', true);
    pushMsg('assistant', reply);
    let i = 0;
    const timer = setInterval(() => {
      i += 2;
      bubble.textContent = reply.slice(0, i);
      $id('messages').scrollTop = $id('messages').scrollHeight;
      if (i >= reply.length) {
        clearInterval(timer);
        bubble.textContent = reply;
      }
    }, 28);
  } catch (err) {
    typingBubble.remove();
    const raw = err && err.message ? err.message : String(err);
    const msg = /failed to fetch|networkerror|load failed/i.test(raw)
      ? `${raw}——多半是 EXAONE 禁止网页直连（CORS）。开一个本地代理再在设置里改接口地址即可（设置里有现成命令，一键复制）`
      : raw;
    appendBubble('assistant', `（出错了：${msg}）`);
  } finally {
    busy = false;
  }
}

async function callExaone(apiKey, history, base) {
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: API_MODEL,
      messages: [{ role: 'system', content: buildSystemPrompt() }, ...history],
      temperature: 0.9,
      max_tokens: 300,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let detail = '';
    try {
      detail = (JSON.parse(body).error && JSON.parse(body).error.message) || '';
    } catch {
      detail = body.slice(0, 120);
    }
    throw new Error(`HTTP ${res.status}${detail ? '：' + detail : ''}`);
  }
  const data = await res.json();
  const reply = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!reply) throw new Error('回复为空');
  return reply.trim();
}

/* ---------- 设置框 ---------- */

function openSettings(notice) {
  $id('settings').classList.add('open');
  $id('settingsNotice').textContent = notice || '';
  $id('keyInput').value = localStorage.getItem(store.key) || '';
  $id('baseInput').value = localStorage.getItem('yuechat-base') || API_BASE_DEFAULT;
}

/** 本地 CORS 代理一键命令（EXAONE 禁止网页直连时用） */
const PROXY_CMD = [
  '# 局域网代理（手机线路）：把本仓库的 local-proxy.js 存到电脑上，然后：',
  'node local-proxy.js',
  '# 手机连同一 Wi-Fi，本页接口地址填 http://<电脑局域网IP>:8787/v1（启动时会打印具体地址）',
].join(String.fromCharCode(10));

/** 连接测试：区分「地址可达但 Key 错」和「网络根本连不上」 */
async function testConnection() {
  const el = $('testResult');
  const base = $id('baseInput').value.trim().replace(new RegExp(String.fromCharCode(47) + '$'), '');
  el.textContent = '测试中…';
  try {
    const r = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer probe-invalid-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: API_MODEL, messages: [{ role: 'user', content: 'ping' }] }),
    });
    if (r.status === 401 || r.status === 403) {
      el.textContent = '✓ 地址可达（401 = Key 无效——填对 Key 就能聊）';
      el.style.color = '#2e9e6b';
    } else {
      el.textContent = '✓ 地址可达，HTTP ' + r.status;
      el.style.color = '#2e9e6b';
    }
  } catch (e) {
    el.textContent = '✗ 连不上这个地址——这个网络访问不了它。手机请用「局域网代理」线路（电脑跑 node local-proxy.js 后填电脑 IP 地址），或换能访问 workers.dev 的网络。';
    el.style.color = '#d98ca0';
  }
}

/** 把本地代理命令复制进剪贴板 */
async function copyProxyCmd() {
  try {
    await navigator.clipboard.writeText(PROXY_CMD);
    $id('settingsNotice').textContent = '已复制代理命令——到终端跑起来，再把接口地址改成 http://localhost:8888/v1';
  } catch {
    $id('settingsNotice').textContent = '复制失败，请手动选中命令复制。';
  }
}

function closeSettings() {
  $id('settings').classList.remove('open');
}

function saveKey() {
  const v = $id('keyInput').value.trim();
  const b = $id('baseInput').value.trim().replace(new RegExp(String.fromCharCode(47) + '$'), '');
  localStorage.setItem(store.key, v);
  localStorage.setItem('yuechat-base', b || API_BASE_DEFAULT);
  $id('settingsNotice').textContent = v ? '已保存，可以开始聊天了。' : '已清空 Key。';
  setTimeout(closeSettings, 800);
}

/* ---------- 启动 ---------- */

function boot() {
  $id('sendBtn').onclick = send;
  $id('backBtn').onclick = backToPicker;
  $id('settingsBtn').onclick = () => openSettings('');
  $id('keySave').onclick = saveKey;
  $id('keyClose').onclick = closeSettings;
  $id('copyProxy').onclick = () => void copyProxyCmd();
  $id('testConn').onclick = () => void testConnection();
  $id('input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  renderPicker();
}

boot();
