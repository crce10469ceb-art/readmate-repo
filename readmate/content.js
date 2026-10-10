// ReadMate content script: highlights, notes, re-applying highlights, reading progress.
(() => {
  if (window.__readmateLoaded) return;
  window.__readmateLoaded = true;

  const COLORS = { yellow: '#fde68a', green: '#bbf7d0', pink: '#fbcfe8', blue: '#bfdbfe' };
  // The page's identity for storing highlights. In the PDF viewer it's the PDF's own URL.
  const computeUrl = () => {
    if (window.__readmateUrl) return window.__readmateUrl;
    if (location.protocol === 'chrome-extension:' && location.pathname.endsWith('/viewer.html')) {
      return location.hash.slice(1).split('#')[0];
    }
    return location.href.split('#')[0];
  };
  let url = computeUrl();

  // ---------- storage helpers ----------
  const store = {
    async get(key, fallback) {
      const r = await chrome.storage.local.get(key);
      return r[key] ?? fallback;
    },
    set: (key, value) => chrome.storage.local.set({ [key]: value })
  };

  // ---------- UI (inside a shadow root so page CSS can't break it) ----------
  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:absolute;top:0;left:0;z-index:2147483647;';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      * { box-sizing: border-box; font-family: system-ui, sans-serif; }
      [hidden] { display: none !important; }
      .bar { position:absolute; display:flex; gap:6px; align-items:center; padding:6px 8px;
             background:#1f2937; border-radius:10px; box-shadow:0 4px 14px rgba(0,0,0,.3); }
      .dot { width:20px; height:20px; border-radius:50%; border:2px solid #fff; cursor:pointer; padding:0; }
      .note-btn { background:none; border:0; color:#fff; font-size:12px; cursor:pointer; }
      .editor { position:absolute; width:250px; background:#fff; color:#111; border:1px solid #ddd;
                border-radius:10px; padding:10px; box-shadow:0 4px 14px rgba(0,0,0,.2); font-size:13px; }
      textarea { width:100%; height:70px; resize:vertical; padding:6px; font-size:13px; }
      .row { display:flex; justify-content:space-between; margin-top:8px; }
      button.btn { padding:5px 10px; border-radius:6px; border:1px solid #ccc; background:#f9fafb; cursor:pointer; }
      button.primary { background:#2563eb; color:#fff; border-color:#2563eb; }
      button.danger { color:#b91c1c; }
      .toast { position:fixed; right:20px; bottom:20px; background:#1f2937; color:#fff; padding:10px 14px;
               border-radius:10px; font-size:13px; display:flex; gap:10px; align-items:center;
               box-shadow:0 4px 14px rgba(0,0,0,.3); }
      .toast button { background:#fff; border:0; border-radius:6px; padding:4px 8px; cursor:pointer; }
    </style>
    <div class="bar" id="bar" hidden></div>
    <div class="editor" id="editor" hidden>
      <textarea id="note" placeholder="Add a note..."></textarea>
      <div class="row">
        <button class="btn danger" id="del">Delete</button>
        <button class="btn primary" id="save">Save note</button>
      </div>
    </div>
    <div class="toast" id="toast" hidden></div>`;
  document.documentElement.appendChild(host);

  const $ = (id) => shadow.getElementById(id);
  const bar = $('bar'), editor = $('editor'), note = $('note'), toast = $('toast');

  for (const [name, color] of Object.entries(COLORS)) {
    const b = document.createElement('button');
    b.className = 'dot';
    b.title = `Highlight ${name}`;
    b.style.background = color;
    b.addEventListener('click', () => highlightPending(color));
    bar.appendChild(b);
  }
  const noteBtn = document.createElement('button');
  noteBtn.className = 'note-btn';
  noteBtn.textContent = '✎ Note';
  noteBtn.addEventListener('click', () => highlightPending(COLORS.yellow, true));
  bar.appendChild(noteBtn);

  function place(el, rect, dy) {
    el.style.left = Math.max(8, rect.left + scrollX) + 'px';
    el.style.top = rect.top + scrollY + dy + 'px';
  }

  // ---------- text helpers ----------
  const fullText = () => {
    const r = document.createRange();
    r.selectNodeContents(document.body);
    return r.toString();
  };
  const offsetOf = (container, offset) => {
    const r = document.createRange();
    r.selectNodeContents(document.body);
    r.setEnd(container, offset);
    return r.toString().length;
  };
  function getContext(range) {
    const full = fullText();
    const start = offsetOf(range.startContainer, range.startOffset);
    const end = start + range.toString().length;
    return { prefix: full.slice(Math.max(0, start - 30), start), suffix: full.slice(end, end + 30) };
  }
  function rangeFromOffsets(s, e) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let pos = 0, started = false, n;
    while ((n = walker.nextNode())) {
      const len = n.nodeValue.length;
      if (!started && s < pos + len) { range.setStart(n, s - pos); started = true; }
      if (started && e <= pos + len) { range.setEnd(n, e - pos); return range; }
      pos += len;
    }
    return null;
  }
  // Find where a saved highlight lives now: try prefix+text+suffix, then looser matches.
  function locate(h) {
    const full = fullText();
    let i = full.indexOf(h.prefix + h.text + h.suffix), start;
    if (i >= 0) start = i + h.prefix.length;
    else if ((i = full.indexOf(h.prefix + h.text)) >= 0) start = i + h.prefix.length;
    else if ((i = full.indexOf(h.text)) >= 0) start = i;
    else return null;
    return rangeFromOffsets(start, start + h.text.length);
  }

  // ---------- wrap / unwrap ----------
  function wrapRange(range, id, color) {
    const root = range.commonAncestorContainer.nodeType === 3
      ? range.commonAncestorContainer.parentNode : range.commonAncestorContainer;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) if (range.intersectsNode(n)) nodes.push(n);

    for (const node of nodes) {
      const start = node === range.startContainer ? range.startOffset : 0;
      const end = node === range.endContainer ? range.endOffset : node.nodeValue.length;
      if (end <= start) continue;
      let target = node;
      if (start > 0) target = node.splitText(start);
      if (end - start < target.nodeValue.length) target.splitText(end - start);
      const mark = document.createElement('mark');
      mark.className = 'readmate-hl';
      mark.dataset.readmateId = id;
      mark.style.cssText = `background:${color};color:inherit;cursor:pointer;border-radius:2px;`;
      target.parentNode.replaceChild(mark, target);
      mark.appendChild(target);
    }
  }
  function unwrapMark(m) {
    const p = m.parentNode;
    if (!p) return;
    while (m.firstChild) p.insertBefore(m.firstChild, m);
    p.removeChild(m);
    p.normalize();
  }

  // ---------- create / edit highlights ----------
  let pendingRange = null;
  let editingId = null;

  async function createHighlight(range, color) {
    const text = range.toString();
    if (!text.trim()) return null;
    const { prefix, suffix } = getContext(range);
    const h = {
      id: crypto.randomUUID(), url, title: document.title,
      text, prefix, suffix, color, note: '', createdAt: Date.now()
    };
    wrapRange(range, h.id, color);
    const all = await store.get('highlights', []);
    all.push(h);
    await store.set('highlights', all);
    getSelection().removeAllRanges();
    return h;
  }

  async function highlightPending(color, withNote = false) {
    if (!pendingRange) return;
    const h = await createHighlight(pendingRange, color);
    pendingRange = null;
    bar.hidden = true;
    if (h && withNote) {
      const mark = document.querySelector(`mark[data-readmate-id="${h.id}"]`);
      if (mark) openEditor(h.id, mark.getBoundingClientRect());
    }
  }

  async function openEditor(id, rect) {
    const all = await store.get('highlights', []);
    const h = all.find((x) => x.id === id);
    if (!h) return;
    editingId = id;
    note.value = h.note || '';
    place(editor, rect, rect.height + 8);
    editor.hidden = false;
    note.focus();
  }

  $('save').addEventListener('click', async () => {
    const all = await store.get('highlights', []);
    const h = all.find((x) => x.id === editingId);
    if (h) { h.note = note.value.trim(); await store.set('highlights', all); }
    editor.hidden = true;
  });
  $('del').addEventListener('click', async () => {
    const all = await store.get('highlights', []);
    await store.set('highlights', all.filter((x) => x.id !== editingId));
    editor.hidden = true; // marks are removed by the storage listener below
  });

  // ---------- events ----------
  document.addEventListener('mouseup', (e) => {
    if (e.composedPath().includes(host)) return;
    setTimeout(() => {
      const sel = getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim()) {
        pendingRange = sel.getRangeAt(0).cloneRange();
        editor.hidden = true;
        place(bar, pendingRange.getBoundingClientRect(), -46);
        bar.hidden = false;
      } else {
        bar.hidden = true;
        if (!e.target.closest?.('mark.readmate-hl')) editor.hidden = true;
      }
    }, 10);
  });

  document.addEventListener('click', (e) => {
    const mark = e.target.closest?.('mark.readmate-hl');
    if (mark && getSelection().isCollapsed) {
      bar.hidden = true;
      openEditor(mark.dataset.readmateId, mark.getBoundingClientRect());
    }
  });

  // Keep the page in sync when highlights are deleted from the side panel.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.highlights) return;
    const ids = new Set((changes.highlights.newValue || []).map((h) => h.id));
    document.querySelectorAll('mark.readmate-hl').forEach((m) => {
      if (!ids.has(m.dataset.readmateId)) unwrapMark(m);
    });
  });

  function scrollToHighlight(id) {
    const mark = document.querySelector(`mark[data-readmate-id="${id}"]`);
    if (!mark) return false;
    mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    mark.style.outline = '3px solid #f59e0b';
    setTimeout(() => (mark.style.outline = ''), 2000);
    return true;
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'HIGHLIGHT') {
      const sel = getSelection();
      if (sel && !sel.isCollapsed) createHighlight(sel.getRangeAt(0).cloneRange(), COLORS.yellow);
    }
    if (msg.type === 'SCROLL_TO') scrollToHighlight(msg.id);
  });

  // ---------- re-apply saved highlights on page load ----------
  async function restoreAll() {
    const all = (await store.get('highlights', [])).filter((h) => h.url === url);
    for (const h of all) {
      if (document.querySelector(`mark[data-readmate-id="${h.id}"]`)) continue;
      const range = locate(h);
      if (range) wrapRange(range, h.id, h.color);
    }
  }

  // ---------- reading progress ----------
  function showToast(html, actions) {
    toast.innerHTML = `<span>${html}</span>`;
    actions.forEach(([label, fn]) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.onclick = () => { toast.hidden = true; fn && fn(); };
      toast.appendChild(b);
    });
    toast.hidden = false;
    setTimeout(() => (toast.hidden = true), 10000);
  }

  async function init() {
    const progress = await store.get('progress', {});
    const saved = progress[url];

    await restoreAll();
    setTimeout(restoreAll, 1500); // second pass for pages that render late

    // Jump to a highlight if the side panel asked us to.
    const pending = await store.get('pendingScroll', null);
    if (pending && pending.url === url) {
      await store.set('pendingScroll', null);
      // PDF text loads page by page, so keep trying for a few seconds.
      let tries = 0;
      const t = setInterval(() => {
        if (scrollToHighlight(pending.id) || ++tries > 20) clearInterval(t);
      }, 500);
    } else if (saved && saved.ratio > 0.05 && saved.ratio < 0.97) {
      const pct = Math.round(saved.ratio * 100);
      showToast(`Continue reading from ${pct}%?`, [
        ['Continue', () => {
          const max = document.documentElement.scrollHeight - innerHeight;
          scrollTo({ top: max * saved.ratio, behavior: 'smooth' });
        }],
        ['Dismiss']
      ]);
    }

    let timer = null;
    addEventListener('scroll', () => {
      if (timer) return;
      timer = setTimeout(async () => {
        timer = null;
        const max = document.documentElement.scrollHeight - innerHeight;
        if (max < innerHeight * 0.5) return; // ignore very short pages
        try {
          const p = await store.get('progress', {});
          p[url] = { ratio: scrollY / max, title: document.title, updatedAt: Date.now() };
          await store.set('progress', p);
        } catch (_) { /* extension was reloaded */ }
      }, 800);
    }, { passive: true });
  }

  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    url = computeUrl();
    init().catch(console.error);
  };
  if (window.__readmateDefer) {
    // PDF viewer: wait until the pages exist, then re-apply highlights as text layers appear.
    window.addEventListener('readmate:ready', start);
    let t = null;
    window.addEventListener('readmate:content-changed', () => {
      clearTimeout(t);
      t = setTimeout(() => started && restoreAll(), 300);
    });
  } else {
    start();
  }
})();
