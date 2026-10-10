const $ = (s) => document.querySelector(s);
let highlights = [];
let progress = {};
const openIds = new Set(); // highlights whose summary box is open

async function load() {
  const r = await chrome.storage.local.get(['highlights', 'progress']);
  highlights = r.highlights || [];
  progress = r.progress || {};
  render();
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  children.forEach((c) => node.append(c));
  return node;
}

function render() {
  renderContinue();
  const q = $('#search').value.trim().toLowerCase();
  const list = $('#list');
  list.replaceChildren();

  const shown = highlights.filter((h) =>
    !q || [h.text, h.note, h.title].some((s) => (s || '').toLowerCase().includes(q)));

  if (!shown.length) {
    list.append(el('p', { className: 'empty' },
      highlights.length ? 'No matches.' : 'No highlights yet.\nSelect text on any page and pick a color.'));
    return;
  }

  const groups = new Map();
  shown.forEach((h) => {
    if (!groups.has(h.url)) groups.set(h.url, []);
    groups.get(h.url).push(h);
  });

  for (const [url, items] of groups) {
    const group = el('section', { className: 'group' }, el('h3', { textContent: items[0].title || url }));
    items.sort((a, b) => a.createdAt - b.createdAt).forEach((h) => group.append(card(h)));
    list.append(group);
  }
}

function card(h) {
  const c = el('div', { className: 'card' });
  c.style.borderLeftColor = h.color;
  const quote = el('p', { className: 'quote', textContent: h.text });
  c.append(quote);
  const sum = el('div', { className: 'summary', hidden: true });
  c.append(sum);
  if (h.note) c.append(el('p', { className: 'note', textContent: h.note }));

  if (openIds.has(h.id) && h.summary) showSummary(sum, h);

  const sumBtn = el('button', {
    className: 'small',
    textContent: openIds.has(h.id) && h.summary ? 'Hide summary' : h.summary ? 'Show summary' : 'Summarize'
  });
  sumBtn.onclick = async () => {
    if (openIds.has(h.id)) {
      openIds.delete(h.id);
      sum.hidden = true;
      sumBtn.textContent = 'Show summary';
      return;
    }
    openIds.add(h.id);
    if (h.summary) { showSummary(sum, h); sumBtn.textContent = 'Hide summary'; return; }
    sumBtn.disabled = true;
    await generate(sum, h);
    sumBtn.disabled = false;
    sumBtn.textContent = h.summary ? 'Hide summary' : 'Summarize';
  };

  const goBtn = el('button', { className: 'small', textContent: 'Go to' });
  goBtn.onclick = () => goTo(h);

  const noteBtn = el('button', { className: 'small', textContent: h.note ? 'Edit note' : 'Add note' });
  noteBtn.onclick = () => {
    const ta = el('textarea', { value: h.note || '', placeholder: 'Your note...' });
    const save = el('button', { className: 'small', textContent: 'Save' });
    save.onclick = async () => {
      h.note = ta.value.trim();
      await chrome.storage.local.set({ highlights });
      render();
    };
    c.replaceChildren(el('p', { className: 'quote', textContent: h.text }), ta, save);
    ta.focus();
  };

  const delBtn = el('button', { className: 'small danger', textContent: 'Delete' });
  delBtn.onclick = async () => {
    highlights = highlights.filter((x) => x.id !== h.id);
    await chrome.storage.local.set({ highlights });
    render();
  };

  c.append(el('div', { className: 'actions' }, sumBtn, goBtn, noteBtn, delBtn));
  return c;
}

function showSummary(box, h) {
  box.hidden = false;
  box.className = 'summary';
  const redo = el('button', { className: 'small redo', textContent: h.summaryMode === 'ai' ? 'Regenerate' : 'Try again' });
  redo.onclick = () => generate(box, h);
  const parts = [el('div', { textContent: h.summary })];
  if (h.summaryMode === 'offline') {
    parts.push(el('p', { className: 'hint', textContent: 'Quick offline summary. Add an API key under ⚙ AI settings for an AI summary.' }));
  }
  parts.push(redo);
  box.replaceChildren(...parts);
}

async function generate(box, h) {
  box.hidden = false;
  box.className = 'summary';
  box.textContent = 'Summarizing…';
  try {
    const { text, mode } = await summarize(h);
    h.summary = text;
    h.summaryMode = mode;
    // Re-read storage so we don't overwrite highlights added in the meantime.
    const { highlights: fresh = [] } = await chrome.storage.local.get('highlights');
    const target = fresh.find((x) => x.id === h.id);
    if (target) { target.summary = text; target.summaryMode = mode; }
    await chrome.storage.local.set({ highlights: fresh });
    showSummary(box, h);
  } catch (err) {
    openIds.delete(h.id);
    box.className = 'summary error';
    box.textContent = err.message;
  }
}

// Remove citation markers like [4][5] so they don't confuse the summary.
const cleanText = (t) => t.replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').trim();

async function summarize(h) {
  const { apiKey } = await chrome.storage.local.get('apiKey');
  const passage = cleanText(h.text);
  if (!apiKey) return { text: localSummary(passage), mode: 'offline' };

  const prompt =
    'Summarize ONLY the passage below in 1-3 plain sentences. ' +
    'Do not add outside information. Reply with the summary only.\n\n' +
    'Passage:\n"""' + passage + '"""';

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-haiku-5-5',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data && data.error && data.error.message) || 'API error (' + res.status + ')');
  const text = data.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  return { text, mode: 'ai' };
}

// Simple offline summary: keep the sentences with the most frequent meaningful words.
function localSummary(clean) {
  const sentences = clean.match(/[^.!?]+[.!?]+(\s|$)/g) || [clean];
  if (sentences.length <= 2) return clean;
  const stop = new Set('the and for with are was were has have had not but also into than then such can may from that this its which their his her these those been being who whom whose when where while'.split(' '));
  const freq = {};
  (clean.toLowerCase().match(/[a-z']+/g) || []).forEach((w) => {
    if (w.length > 2 && !stop.has(w)) freq[w] = (freq[w] || 0) + 1;
  });
  const scored = sentences.map((s, i) => {
    const words = s.toLowerCase().match(/[a-z']+/g) || [];
    const score = words.reduce((a, w) => a + (freq[w] || 0), 0) / (words.length || 1);
    return { s: s.trim(), i, score };
  });
  const n = Math.min(3, Math.ceil(sentences.length / 3));
  return scored.sort((a, b) => b.score - a.score).slice(0, n)
    .sort((a, b) => a.i - b.i).map((x) => x.s).join(' ');
}

function renderContinue() {
  const entries = Object.entries(progress)
    .filter(([, p]) => p.ratio > 0.05 && p.ratio < 0.97)
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
    .slice(0, 5);
  $('#continue').hidden = !entries.length;
  const box = $('#continueList');
  box.replaceChildren();
  entries.forEach(([url, p]) => {
    const b = el('button', { className: 'resume' },
      el('span', { textContent: p.title || url }),
      el('span', { textContent: Math.round(p.ratio * 100) + '%' }));
    b.onclick = () => openTab(url);
    box.append(b);
  });
}

// A PDF open in ReadMate's viewer lives at chrome-extension://.../viewer.html#<pdf url>.
function normalizeTabUrl(u) {
  try {
    const x = new URL(u);
    if (x.protocol === 'chrome-extension:' && x.pathname.endsWith('/viewer.html')) {
      return x.hash.slice(1).split('#')[0];
    }
  } catch (_) { /* not a URL */ }
  return u.split('#')[0];
}

async function findTab(url) {
  const tabs = await chrome.tabs.query({});
  return tabs.find((t) => t.url && normalizeTabUrl(t.url) === url);
}

const isLocalPdf = (url) => url.startsWith('readmate-local://');

async function openTab(url) {
  const tab = await findTab(url);
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } else if (isLocalPdf(url)) {
    alert('This PDF was opened from your computer. Open the same file again in the ReadMate viewer.');
    await chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html') });
  } else {
    await chrome.tabs.create({ url });
  }
}

async function goTo(h) {
  await chrome.storage.local.set({ pendingScroll: { url: h.url, id: h.id } });
  const tab = await findTab(h.url);
  if (tab) {
    await openTab(h.url);
    chrome.tabs.sendMessage(tab.id, { type: 'SCROLL_TO', id: h.id }).catch(() => {});
  } else if (isLocalPdf(h.url)) {
    await openTab(h.url);
  } else {
    await chrome.tabs.create({ url: h.url });
  }
}

function exportMarkdown() {
  const groups = new Map();
  highlights.forEach((h) => {
    if (!groups.has(h.url)) groups.set(h.url, []);
    groups.get(h.url).push(h);
  });
  let md = '# ReadMate highlights\n\n';
  for (const [url, items] of groups) {
    md += `## ${items[0].title || url}\n${url}\n\n`;
    items.forEach((h) => {
      md += `> ${h.text.replace(/\n+/g, ' ')}\n\n`;
      if (h.note) md += `**Note:** ${h.note}\n\n`;
    });
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
  a.download = 'readmate-highlights.md';
  a.click();
  URL.revokeObjectURL(a.href);
}

$('#search').addEventListener('input', render);
$('#export').addEventListener('click', exportMarkdown);
$('#openPdf').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html') }));
$('#saveKey').addEventListener('click', async () => {
  const key = $('#apiKey').value.trim();
  if (!key) return;
  await chrome.storage.local.set({ apiKey: key });
  $('#apiKey').value = '';
  $('#apiKey').placeholder = 'Key saved ✓ (paste a new one to replace)';
});
chrome.storage.local.get('apiKey').then(({ apiKey }) => {
  if (apiKey) $('#apiKey').placeholder = 'Key saved ✓ (paste a new one to replace)';
});
chrome.storage.onChanged.addListener(() => {
  if (document.activeElement?.tagName === 'TEXTAREA') return; // don't wipe a note being typed
  load();
});
load();
