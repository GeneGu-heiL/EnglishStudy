/* ============ 基础工具 ============ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const KEY = "drama-srs-v1";

function todayStr() {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) {
  let a = seed;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function toast(msg) {
  let el = $(".toast");
  if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 1800);
}

/* ============ 状态 ============ */
const defaultSettings = { rate: 0.9, voiceURI: "", clozeMode: "auto" };

function normalize(s) {
  if (!s || !Array.isArray(s.cards)) throw new Error("文件格式不对");
  s.settings = Object.assign({}, defaultSettings, s.settings || {});
  s.cards = s.cards.map(c => ({
    id: c.id || uid(),
    show: c.show || "", episode: c.episode || "", tags: c.tags || "",
    original: c.original || "", mine: c.mine || "", note: c.note || "",
    createdAt: c.createdAt || todayStr(), due: c.due || todayStr(),
    interval: c.interval || 0, ease: c.ease || 2.3, reps: c.reps || 0, lapses: c.lapses || 0
  }));
  return s;
}
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) {}
  return { cards: [], settings: Object.assign({}, defaultSettings) };
}
let state = load();
function save() { localStorage.setItem(KEY, JSON.stringify(state)); }

const isDue = c => !c.due || c.due <= todayStr();
function dueCards() {
  return state.cards.filter(isDue).sort((a, b) => (a.due || "").localeCompare(b.due || ""));
}

/* ============ IndexedDB：跟读录音 ============ */
const DB_NAME = "drama-srs-audio";
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("rec")) db.createObjectStore("rec");
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbPut(k, v) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction("rec", "readwrite");
    tx.objectStore("rec").put(v, k);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function idbGet(k) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction("rec", "readonly");
    const q = tx.objectStore("rec").get(k);
    q.onsuccess = () => res(q.result || null);
    q.onerror = () => rej(q.error);
  });
}
async function idbDel(k) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction("rec", "readwrite");
    tx.objectStore("rec").delete(k);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

/* ============ 语音朗读（TTS） ============ */
let voices = [];
function refreshVoices() {
  voices = (window.speechSynthesis ? speechSynthesis.getVoices() : []).filter(v => /^en/i.test(v.lang));
  const sel = $("#voiceSelect");
  if (!sel) return;
  const cur = state.settings.voiceURI;
  if (!voices.length) {
    sel.innerHTML = `<option value="">未检测到英语语音</option>`;
    return;
  }
  sel.innerHTML = voices
    .map(v => `<option value="${esc(v.voiceURI)}" ${v.voiceURI === cur ? "selected" : ""}>${esc(v.name)} (${esc(v.lang)})</option>`)
    .join("");
}
function currentVoice() {
  if (!voices.length) return null;
  return voices.find(v => v.voiceURI === state.settings.voiceURI)
    || voices.find(v => /en-US/i.test(v.lang)) || voices[0];
}
function speak(text, rate) {
  const t = String(text || "").trim();
  if (!t) return;
  if (!window.speechSynthesis) { toast("当前浏览器不支持语音朗读"); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(t);
  const v = currentVoice();
  if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = "en-US"; }
  u.rate = rate || Number(state.settings.rate) || 0.9;
  u.pitch = 1;
  speechSynthesis.speak(u);
}
if (window.speechSynthesis) {
  refreshVoices();
  speechSynthesis.onvoiceschanged = refreshVoices;
  setTimeout(refreshVoices, 300);
}
document.addEventListener("click", e => {
  const a = e.target.closest("[data-speak]");
  if (a) { speak(a.dataset.speak); return; }
  const b = e.target.closest("[data-speak-slow]");
  if (b) { speak(b.dataset.speakSlow, 0.65); return; }
});

/* ============ 挖空 ============ */
function clozeTokens(card) {
  const text = card.original || "";
  if (/\{\{.+?\}\}/.test(text)) {
    const out = [];
    const re = /\{\{(.+?)\}\}/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push({ t: text.slice(last, m.index), h: false });
      out.push({ t: m[1], h: true });
      last = re.lastIndex;
    }
    if (last < text.length) out.push({ t: text.slice(last), h: false });
    return out;
  }
  if (state.settings.clozeMode === "manual") return [{ t: text, h: false }];

  const parts = text.split(/(\b[A-Za-z][A-Za-z']*\b)/);
  const idx = [];
  parts.forEach((p, i) => {
    if (/^[A-Za-z][A-Za-z']*$/.test(p) && p.length >= 4) idx.push(i);
  });
  if (!idx.length) return [{ t: text, h: false }];

  const rand = rng(hashStr(card.id + "|" + text));
  const n = Math.max(1, Math.min(3, Math.round(idx.length / 3)));
  const picked = new Set();
  const pool = idx.slice();
  while (picked.size < n && pool.length) {
    picked.add(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  }
  return parts.map((p, i) => ({ t: p, h: picked.has(i) }));
}
function clozeHtml(card, reveal) {
  return clozeTokens(card).map(tok => {
    if (!tok.h) return esc(tok.t);
    if (reveal) return `<span class="cloze-hit">${esc(tok.t)}</span>`;
    const w = Math.max(3, Math.min(11, tok.t.length));
    return `<span class="blank">${"&nbsp;".repeat(w)}</span>`;
  }).join("");
}

/* ============ 路由 ============ */
let editingId = null;
const routes = { review: viewReview, cards: viewCards, add: viewAdd, settings: viewSettings };

function router() {
  const name = (location.hash.replace(/^#\/?/, "") || "review").split("?")[0];
  const route = routes[name] ? name : "review";
  $$(".tabbar a").forEach(a => a.classList.toggle("active", a.dataset.tab === route));
  $("#app").innerHTML = "";
  routes[route]();
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", router);

/* ============ 复习页 ============ */
const rq = { queue: [], i: 0, revealed: false };

function viewReview() {
  if (!rq.queue.length || rq.i >= rq.queue.length) {
    rq.queue = dueCards();
    rq.i = 0;
    rq.revealed = false;
  }
  if (!rq.queue.length) {
    $("#app").innerHTML = `<div class="panel empty">今天没有到期卡片 🎉
      <div class="hint">去「添加」页摘几句新的，或明天再来。</div></div>`;
    return;
  }
  renderReviewCard();
}

function renderReviewCard() {
  const c = rq.queue[rq.i];
  if (!c) { rq.queue = []; viewReview(); return; }
  const pct = Math.round((rq.i / rq.queue.length) * 100);
  const tagStr = c.tags ? `· ${esc(c.tags)}` : "";

  $("#app").innerHTML = `
    <div class="progress"><div style="width:${pct}%"></div></div>
    <div class="panel">
      <div class="review-meta">${esc(c.show)} ${esc(c.episode || "")} ${tagStr}
        <span style="float:right">${rq.i + 1} / ${rq.queue.length}</span></div>
      <div class="cloze">${clozeHtml(c, rq.revealed)}</div>
      <div class="row">
        <button class="btn ghost sm" data-speak="${esc(c.original)}">🔊 听原句</button>
        <button class="btn ghost sm" data-speak-slow="${esc(c.original)}">🐢 慢速</button>
        ${rq.revealed ? "" : `<button class="btn" id="revealBtn">显示答案</button>`}
      </div>
      <div class="answer ${rq.revealed ? "" : "hidden"}">
        <div class="full">${esc(c.original)}</div>
        ${c.mine ? `<p><b>我的造句：</b>${esc(c.mine)}</p>` : ""}
        ${c.note ? `<p><b>笔记：</b>${esc(c.note)}</p>` : ""}
        <div class="rec">
          <div class="rec-btns">
            <button class="btn ghost sm" id="recBtn">🎙 录音跟读</button>
            <button class="btn ghost sm" id="recDel" hidden>删除录音</button>
          </div>
          <audio id="recAudio" controls hidden></audio>
          <p class="hint" id="recHint"></p>
        </div>
        <div class="rating">
          <button class="btn red" data-r="again">忘记</button>
          <button class="btn orange" data-r="hard">模糊</button>
          <button class="btn green" data-r="good">记得</button>
          <button class="btn purple" data-r="easy">很简单</button>
        </div>
      </div>
    </div>
  `;

  const revealBtn = $("#revealBtn");
  if (revealBtn) revealBtn.onclick = () => { rq.revealed = true; renderReviewCard(); };

  $$("[data-r]").forEach(b => { b.onclick = () => rateCard(b.dataset.r); });

  if (rq.revealed) setupRecorder(c.id);
}

function rateCard(r) {
  const c = rq.queue[rq.i];
  if (!c) return;
  const interval = c.interval || 0;
  let ease = c.ease || 2.3;
  c.reps = (c.reps || 0) + 1;

  if (r === "again") {
    c.interval = 0; c.lapses = (c.lapses || 0) + 1; ease = Math.max(1.3, ease - 0.2);
  } else if (r === "hard") {
    c.interval = interval ? Math.max(1, Math.round(interval * 1.2)) : 1; ease = Math.max(1.3, ease - 0.15);
  } else if (r === "good") {
    c.interval = interval ? Math.max(1, Math.round(interval * ease)) : 1; ease = Math.min(2.8, ease + 0.05);
  } else if (r === "easy") {
    c.interval = interval ? Math.max(2, Math.round(interval * ease * 1.3)) : 2; ease = Math.min(2.8, ease + 0.15);
  }
  c.ease = ease;
  c.due = addDays(todayStr(), c.interval);
  c.lastReviewed = todayStr();
  save();

  rq.i++;
  rq.revealed = false;
  renderReviewCard();
}

/* ============ 录音跟读 ============ */
async function setupRecorder(cardId) {
  const btn = $("#recBtn"), del = $("#recDel"), audio = $("#recAudio"), hint = $("#recHint");
  if (!btn) return;

  let blobUrl = null;
  let mr = null, chunks = [], stream = null;

  function show(blob, msg) {
    if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
    if (!blob) {
      audio.hidden = true; audio.removeAttribute("src"); del.hidden = true;
      hint.textContent = msg || "";
      return;
    }
    blobUrl = URL.createObjectURL(blob);
    audio.src = blobUrl;
    audio.hidden = false;
    del.hidden = false;
    hint.textContent = msg || "录音已保存，点播放对比。";
  }

  try {
    const existed = await idbGet(cardId);
    if (existed) show(existed, "");
  } catch (e) {}

  btn.onclick = async () => {
    if (mr && mr.state === "recording") { mr.stop(); return; }
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      alert("当前浏览器不支持录音。建议用 Chrome / Edge / Safari，并通过 https 或 localhost 打开。");
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      alert("无法访问麦克风：" + e.message + "\n\n录音需要 HTTPS 或 localhost 环境，file:// 直接打开通常不行。");
      return;
    }
    chunks = [];
    mr = new MediaRecorder(stream);
    mr.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    mr.onstop = async () => {
      if (stream) stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(chunks, { type: mr.mimeType || "audio/webm" });
      try {
        await idbPut(cardId, blob);
        show(blob);
        toast("录音已保存");
      } catch (e) { toast("录音保存失败"); }
      btn.textContent = "🎙 重新录音";
      mr = null;
    };
    mr.start();
    btn.textContent = "⏹ 停止录音";
    hint.textContent = "录音中… 读完整句后点“停止录音”。";
  };

  del.onclick = async () => {
    if (!confirm("删除这条跟读录音？")) return;
    try { await idbDel(cardId); } catch (e) {}
    show(null, "录音已删除。");
    btn.textContent = "🎙 录音跟读";
  };
}

/* ============ 卡片列表页 ============ */
const ls = { q: "", filter: "all", sort: "due", page: 1, size: 20 };

function viewCards() {
  const all = state.cards;
  const dueN = all.filter(isDue).length;
  const masteredN = all.filter(c => (c.interval || 0) >= 21).length;

  $("#app").innerHTML = `
    <div class="panel">
      <div class="searchbar">
        <input id="q" type="search" placeholder="搜索剧名 / 原句 / 标签 / 笔记…" value="${esc(ls.q)}">
      </div>
      <div class="filters">
        <button class="chip ${ls.filter === "all" ? "on" : ""}" data-f="all">全部 ${all.length}</button>
        <button class="chip ${ls.filter === "due" ? "on" : ""}" data-f="due">到期 ${dueN}</button>
        <button class="chip ${ls.filter === "mastered" ? "on" : ""}" data-f="mastered">已熟 ${masteredN}</button>
      </div>
      <div class="sortrow">
        <select id="sort">
          <option value="due" ${ls.sort === "due" ? "selected" : ""}>按下次复习时间</option>
          <option value="new" ${ls.sort === "new" ? "selected" : ""}>按创建时间（新→旧）</option>
          <option value="interval" ${ls.sort === "interval" ? "selected" : ""}>按复习间隔（长→短）</option>
        </select>
      </div>
    </div>
    <div id="list"></div>
    <div class="pager" id="pager"></div>
  `;

  $("#q").oninput = e => { ls.q = e.target.value; ls.page = 1; renderCardList(); };
  $("#sort").onchange = e => { ls.sort = e.target.value; ls.page = 1; renderCardList(); };
  $$(".chip").forEach(ch => {
    ch.onclick = () => {
      ls.filter = ch.dataset.f;
      ls.page = 1;
      $$(".chip").forEach(x => x.classList.toggle("on", x === ch));
      renderCardList();
    };
  });

  renderCardList();
}

function filteredCards() {
  const q = ls.q.trim().toLowerCase();
  let arr = state.cards.filter(c => {
    if (ls.filter === "due" && !isDue(c)) return false;
    if (ls.filter === "mastered" && (c.interval || 0) < 21) return false;
    if (!q) return true;
    return [c.show, c.episode, c.original, c.mine, c.note, c.tags].join(" ").toLowerCase().includes(q);
  });
  if (ls.sort === "new") arr.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  else if (ls.sort === "interval") arr.sort((a, b) => (b.interval || 0) - (a.interval || 0));
  else arr.sort((a, b) => (a.due || "").localeCompare(b.due || ""));
  return arr;
}

function renderCardList() {
  const list = $("#list"), pager = $("#pager");
  if (!list) return;
  const arr = filteredCards();
  const total = arr.length;
  const pages = Math.max(1, Math.ceil(total / ls.size));
  if (ls.page > pages) ls.page = pages;
  const start = (ls.page - 1) * ls.size;
  const pageItems = arr.slice(start, start + ls.size);

  if (!total) {
    list.innerHTML = `<div class="panel empty">没有匹配的卡片
      <div class="hint">换个关键词，或切换筛选条件。</div></div>`;
    pager.innerHTML = "";
    return;
  }

  list.innerHTML = pageItems.map(c => {
    const tags = (c.tags || "").split(",").map(t => t.trim()).filter(Boolean)
      .map(t => `<em>${esc(t)}</em>`).join("");
    return `
      <div class="card">
        <div class="card-head">
          <b>${esc(c.show)}</b><span>${esc(c.episode || "")}</span>
          <span class="tags">${tags}</span>
        </div>
        <p class="original">${esc(c.original)}</p>
        ${c.mine ? `<p class="mine">造句：${esc(c.mine)}</p>` : ""}
        ${c.note ? `<p class="note">笔记：${esc(c.note)}</p>` : ""}
        <div class="card-foot">
          <span>间隔 ${c.interval || 0} 天 · 下次 ${esc(c.due || "今天")}</span>
          <span class="card-actions">
            <button class="btn ghost sm" data-speak="${esc(c.original)}">🔊</button>
            <button class="btn ghost sm" data-edit="${c.id}">编辑</button>
            <button class="btn danger sm" data-del="${c.id}">删除</button>
          </span>
        </div>
      </div>`;
  }).join("");

  $$("[data-edit]", list).forEach(b => {
    b.onclick = () => { editingId = b.dataset.edit; location.hash = "#/add"; };
  });
  $$("[data-del]", list).forEach(b => {
    b.onclick = () => {
      if (!confirm("删除这张卡？录音也会一起删掉。")) return;
      const id = b.dataset.del;
      state.cards = state.cards.filter(c => c.id !== id);
      save();
      idbDel(id).catch(() => {});
      if (editingId === id) editingId = null;
      toast("已删除");
      viewCards();
      $$(".chip").forEach(x => x.classList.toggle("on", x.dataset.f === ls.filter));
    };
  });

  pager.innerHTML = pages <= 1 ? `<span>共 ${total} 张</span>` : `
    <button class="btn ghost sm" id="prev" ${ls.page <= 1 ? "disabled" : ""}>上一页</button>
    <span>${ls.page} / ${pages}（共 ${total} 张）</span>
    <button class="btn ghost sm" id="next" ${ls.page >= pages ? "disabled" : ""}>下一页</button>
  `;
  const prev = $("#prev"), next = $("#next");
  if (prev) prev.onclick = () => { ls.page--; renderCardList(); window.scrollTo(0, 0); };
  if (next) next.onclick = () => { ls.page++; renderCardList(); window.scrollTo(0, 0); };
}

/* ============ 添加 / 编辑页 ============ */
function viewAdd() {
  const c = editingId ? state.cards.find(x => x.id === editingId) : null;
  const v = k => esc(c ? c[k] : "");

  $("#app").innerHTML = `
    <div class="panel">
      <h2>${c ? "编辑卡片" : "添加表达卡"}</h2>
      <form id="cardForm">
        <div class="grid3">
          <div><label>剧名</label><input name="show" required placeholder="Modern Family" value="${v("show")}"></div>
          <div><label>集数 / 片段</label><input name="episode" placeholder="S01E01 00:00-00:30" value="${v("episode")}"></div>
          <div><label>标签</label><input name="tags" placeholder="口语, 高频, 连读" value="${v("tags")}"></div>
        </div>
        <label>原句（用 {{}} 标记要挖空的部分）</label>
        <textarea name="original" required placeholder="I didn't {{see}} that coming.">${v("original")}</textarea>
        <p class="hint">不写 {{}} 也可以：会自动把较长的单词挖空。设置里可改成“仅手动标记”。</p>
        <label>我的造句</label>
        <textarea name="mine" placeholder="I didn’t see the rain coming, so I got wet.">${v("mine")}</textarea>
        <label>笔记</label>
        <textarea name="note" placeholder="意思、使用场景、连读弱读、语气……">${v("note")}</textarea>
        <div class="row">
          <button type="submit" class="btn">${c ? "保存修改" : "添加卡片"}</button>
          <button type="button" class="btn ghost" id="previewBtn">🔊 试听原句</button>
          ${c ? `<button type="button" class="btn ghost" id="cancelEdit">取消编辑</button>` : ""}
        </div>
      </form>
    </div>
  `;

  $("#previewBtn").onclick = () => {
    const t = $('[name="original"]').value.trim();
    if (t) speak(t.replace(/\{\{|\}\}/g, ""));
    else toast("先输入原句");
  };
  const cancel = $("#cancelEdit");
  if (cancel) cancel.onclick = () => { editingId = null; location.hash = "#/cards"; };

  $("#cardForm").onsubmit = e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = {
      show: String(fd.get("show") || "").trim(),
      episode: String(fd.get("episode") || "").trim(),
      original: String(fd.get("original") || "").trim(),
      mine: String(fd.get("mine") || "").trim(),
      note: String(fd.get("note") || "").trim(),
      tags: String(fd.get("tags") || "").trim()
    };
    if (!data.show || !data.original) { toast("剧名和原句必填"); return; }

    if (editingId) {
      const target = state.cards.find(x => x.id === editingId);
      if (target) Object.assign(target, data);
      editingId = null;
      toast("已保存修改");
    } else {
      state.cards.unshift(Object.assign({
        id: uid(), createdAt: todayStr(), due: todayStr(),
        interval: 0, ease: 2.3, reps: 0, lapses: 0
      }, data));
      toast("已添加");
    }
    save();
    location.hash = "#/cards";
    if (location.hash === "#/cards") router();
  };
}

/* ============ 设置页 ============ */
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  deferredPrompt = e;
});

function viewSettings() {
  const total = state.cards.length;
  const due = dueCards().length;
  const mastered = state.cards.filter(c => (c.interval || 0) >= 21).length;

  $("#app").innerHTML = `
    <div class="panel">
      <h2>统计</h2>
      <div class="statrow">
        <div class="stat"><b>${total}</b><span>总卡片</span></div>
        <div class="stat"><b>${due}</b><span>今日到期</span></div>
        <div class="stat"><b>${mastered}</b><span>已较熟</span></div>
      </div>
    </div>

    <div class="panel">
      <h2>语音设置</h2>
      <label>英语语音</label>
      <select id="voiceSelect"></select>
      <label>语速</label>
      <select id="rateSelect">
        <option value="0.7">0.7 慢速</option>
        <option value="0.85">0.85 稍慢</option>
        <option value="1">1.0 正常</option>
        <option value="1.15">1.15 稍快</option>
      </select>
      <div class="row">
        <button class="btn ghost" id="testVoice">🔊 播放测试句</button>
      </div>
      <p class="hint">语音质量取决于系统安装的英语语音。手机端首次播放需点击触发。</p>
    </div>

    <div class="panel">
      <h2>挖空设置</h2>
      <label>正面挖空方式</label>
      <select id="clozeSelect">
        <option value="auto">自动挖空（没写 {{}} 时自动遮挡长单词）</option>
        <option value="manual">仅手动标记（只遮挡 {{}} 里的内容）</option>
      </select>
      <p class="hint">在添加卡片时用 {{ }} 包住要挖空的词，例如：I didn't {{see}} that coming.</p>
    </div>

    <div class="panel">
      <h2>数据</h2>
      <div class="row">
        <button class="btn ghost" id="exportBtn">导出 JSON</button>
        <label class="btn ghost" style="display:inline-block;position:relative;overflow:hidden;margin:0;cursor:pointer;color:var(--blue-text)">
          导入 JSON
          <input type="file" id="importInput" accept=".json,application/json"
                 style="position:absolute;left:0;top:0;opacity:0;width:100%;height:100%;cursor:pointer">
        </label>
        <button class="btn danger" id="clearBtn">清空全部</button>
      </div>
      <p class="hint">导出只包含卡片数据，不含录音。录音保存在本机浏览器 IndexedDB 中。</p>
    </div>

    <div class="panel">
      <h2>安装到手机</h2>
      <div class="row">
        <button class="btn" id="installBtn">安装到主屏幕</button>
      </div>
      <p class="hint">iPhone：Safari 打开 → 分享 → “添加到主屏幕”。<br>
      Android Chrome：菜单 → “安装应用”或“添加到主屏幕”。</p>
    </div>

    <div class="panel">
      <h2>关于</h2>
      <p class="hint">美剧精练复习器 · PWA 版本<br>
      数据保存在本浏览器，换设备请先导出 JSON。</p>
    </div>
  `;

  refreshVoices();
  $("#rateSelect").value = String(state.settings.rate);
  $("#clozeSelect").value = state.settings.clozeMode;

  $("#voiceSelect").onchange = e => { state.settings.voiceURI = e.target.value; save(); speak("This is a voice test."); };
  $("#rateSelect").onchange = e => { state.settings.rate = Number(e.target.value); save(); };
  $("#clozeSelect").onchange = e => { state.settings.clozeMode = e.target.value; save(); toast("已保存"); };
  $("#testVoice").onclick = () => speak("I didn't see that coming.");

  $("#exportBtn").onclick = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "drama-srs-backup.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  $("#importInput").onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = normalize(JSON.parse(reader.result));
        if (!confirm("导入会替换当前所有卡片，继续？")) { e.target.value = ""; return; }
        state = data;
        save();
        toast("导入成功");
        viewSettings();
      } catch (err) {
        alert("导入失败：" + err.message);
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  };

  $("#clearBtn").onclick = () => {
    if (!confirm("确定清空全部卡片？建议先导出备份。")) return;
    state = { cards: [], settings: state.settings };
    save();
    toast("已清空");
    viewSettings();
  };

  $("#installBtn").onclick = async () => {
    if (!deferredPrompt) {
      alert("当前浏览器暂不支持一键安装。\n\niPhone 用 Safari：分享 → 添加到主屏幕。\nAndroid Chrome：菜单 → 安装应用。");
      return;
    }
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch (e) {}
    deferredPrompt = null;
  };
}

/* ============ 网络状态 ============ */
function updateNet() {
  const el = $("#netBadge");
  if (!el) return;
  const on = navigator.onLine;
  el.textContent = on ? "在线" : "离线可用";
  el.classList.toggle("off", !on);
}
window.addEventListener("online", updateNet);
window.addEventListener("offline", updateNet);
updateNet();

/* ============ PWA 注册 ============ */
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

/* ============ 启动 ============ */
router();