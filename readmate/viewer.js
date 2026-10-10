// ReadMate PDF viewer: renders a PDF with PDF.js (canvas + selectable text layer).
// content.js runs in this same page, so highlights, notes and progress work like on web pages.
import * as pdfjsLib from './lib/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.mjs');

const $ = (s) => document.querySelector(s);
const pagesEl = $('#pages');
const statusEl = $('#status');
const landing = $('#landing');

const fileUrl = location.hash.slice(1).split('#')[0];

function nameFromUrl(u) {
  try {
    const last = new URL(u).pathname.split('/').filter(Boolean).pop() || u;
    return decodeURIComponent(last);
  } catch (_) { return u; }
}

// Draw each page's canvas only when it scrolls near the screen (keeps big PDFs fast).
const observer = new IntersectionObserver((entries) => {
  entries.forEach((en) => {
    if (!en.isIntersecting) return;
    observer.unobserve(en.target);
    renderCanvas(en.target.__p).catch(console.error);
  });
}, { rootMargin: '900px 0px' });

async function renderCanvas({ page, viewport, div }) {
  const dpr = window.devicePixelRatio || 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = viewport.width + 'px';
  canvas.style.height = viewport.height + 'px';
  div.prepend(canvas);
  await page.render({
    canvasContext: canvas.getContext('2d'),
    viewport,
    transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null
  }).promise;
}

async function renderText({ page, viewport, textDiv }) {
  const layer = new pdfjsLib.TextLayer({
    textContentSource: page.streamTextContent(),
    container: textDiv,
    viewport
  });
  await layer.render();
  // PDF.js marks line ends with <br>. Add a space there so words don't glue together
  // when text is selected, highlighted or summarized.
  textDiv.querySelectorAll('br').forEach((br) => br.before(document.createTextNode(' ')));
}

async function openPdf(source, displayName) {
  landing.hidden = true;
  $('#title').textContent = displayName;
  document.title = displayName;
  statusEl.textContent = 'Loading PDF…';

  let pdf;
  try {
    pdf = await pdfjsLib.getDocument(source).promise;
  } catch (err) {
    statusEl.textContent = 'Could not open this PDF: ' + (err && err.message ? err.message : err);
    return;
  }

  const width = Math.min(window.innerWidth - 32, 900);
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = width / base.width;
    const viewport = page.getViewport({ scale });

    const div = document.createElement('div');
    div.className = 'page';
    div.style.width = viewport.width + 'px';
    div.style.height = viewport.height + 'px';
    div.style.setProperty('--scale-factor', scale);

    const textDiv = document.createElement('div');
    textDiv.className = 'textLayer';
    div.append(textDiv);

    const p = { page, viewport, div, textDiv };
    div.__p = p;
    pagesEl.append(div);
    observer.observe(div);
    pages.push(p);
  }
  statusEl.textContent = '';

  // Page boxes exist now, so reading progress and layout are stable: let content.js start.
  window.dispatchEvent(new Event('readmate:ready'));

  // Then fill in the selectable text page by page, re-applying saved highlights as we go.
  for (let i = 0; i < pages.length; i++) {
    try { await renderText(pages[i]); } catch (err) { console.error(err); }
    if (i % 10 === 9) window.dispatchEvent(new Event('readmate:content-changed'));
  }
  window.dispatchEvent(new Event('readmate:content-changed'));
}

// ---------- landing page: pick a local file or paste a link ----------
$('#picker').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  // Local files have no URL, so key their highlights by file name + size.
  window.__readmateUrl = 'readmate-local://' + encodeURIComponent(file.name) + '-' + file.size;
  const data = new Uint8Array(await file.arrayBuffer());
  openPdf({ data }, file.name);
});

function goToUrl() {
  const value = $('#urlInput').value.trim();
  if (!value) return;
  location.hash = value;
  location.reload();
}
$('#urlGo').addEventListener('click', goToUrl);
$('#urlInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') goToUrl(); });

if (fileUrl) openPdf({ url: fileUrl }, nameFromUrl(fileUrl));
else landing.hidden = false;
