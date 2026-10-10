# 📖 ReadMate

**A Chrome extension for active reading.** Highlight text on any web page *or PDF*, attach notes, get a summary of just the part you highlighted, pick up where you left off, and export everything to Markdown.

> Built with Claude Code as a 3-day project. Plain JavaScript, Manifest V3, no build step.

<!-- Add your demo link here, e.g. [▶ Watch the 90-second demo](https://...) -->

![Highlights and notes on a web page](docs/screenshots/01-web-highlights.png)

## Features

| | |
|---|---|
| **Highlight anywhere** | Select text and pick one of 4 colors from a floating toolbar, or use the right-click menu. |
| **Notes** | Click any highlight to add, edit or delete a note. |
| **PDF support** | `.pdf` links open in ReadMate's own viewer (built on PDF.js), with the same highlighting and notes as web pages. |
| **Summarize a highlight** | One click summarizes *only* the highlighted passage. Uses Claude if you add an API key, otherwise a quick offline summary. |
| **Highlights persist** | Come back later and your highlights are re-applied to the page. |
| **Library side panel** | Search every highlight and note, grouped by page, and jump straight back to the spot ("Go to"). |
| **Resume reading** | Remembers your scroll position and offers *"Continue reading from 42%?"*. |
| **Export** | Download all highlights and notes as a Markdown file. |

<p>
  <img src="docs/screenshots/03-pdf-viewer.png" alt="Highlights inside the PDF viewer" width="62%">
  <img src="docs/screenshots/02-side-panel.png" alt="Side panel library" width="30%">
</p>

## Install (developer mode)

1. Download or clone this repo.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the project folder (the one containing `manifest.json`).
4. Pin ReadMate, open any article, and select some text.

Click the toolbar icon to open the library side panel.

## How to use

- **Highlight:** select text, then click a color. Use **✎ Note** to highlight and write a note in one step.
- **Edit or delete:** click a highlight on the page, or use the buttons in the side panel.
- **Summarize:** open the side panel and click **Summarize** on any highlight.
- **PDFs:** click any `.pdf` link and it opens in the viewer. For a file on your computer, or a link without `.pdf` in it, click **Open PDF viewer** in the side panel, then choose the file or paste the link.
- **Export:** click **Export Markdown** in the side panel.

### Optional: AI summaries

Without a key, **Summarize** gives a quick offline summary (it picks the most important sentences). For real AI summaries:

1. Create an API key at [console.anthropic.com](https://console.anthropic.com).
2. In the side panel, open **⚙ AI settings**, paste the key and click **Save key**.

The key is stored only in your browser (`chrome.storage.local`) and is sent only to `api.anthropic.com`. Summaries use the `claude-haiku-5-5` model and only the highlighted text is sent.

## How it works

```
manifest.json      Manifest V3 config and permissions
background.js      Right-click menu; redirects .pdf links to the viewer (declarativeNetRequest)
content.js         Runs on every page: selection toolbar, wrapping text in <mark>, notes,
                   re-applying highlights, reading progress
sidepanel.*        Library UI: search, notes, Go to, Summarize, export
viewer.*           PDF viewer built on PDF.js (canvas + selectable text layer)
lib/               Bundled PDF.js (Apache-2.0)
```

**Highlighting.** A highlight is saved as the selected text plus ~30 characters of context before and after it. When a page loads, the extension searches the page text for that snippet and re-wraps it in a `<mark>`. If the page changed slightly, it falls back to looser matches.

**PDFs.** Chrome's built-in PDF viewer doesn't allow extensions to touch its content, so ReadMate redirects `.pdf` links to its own viewer. The viewer draws each page to a `<canvas>` and puts PDF.js's invisible text layer on top, so the PDF behaves like an ordinary web page and the same `content.js` handles highlights. The page image is blended with `mix-blend-mode: multiply` so highlight colors show through while the text stays sharp.

**Storage.** Everything lives in `chrome.storage.local` on your device: no server, no account, no tracking.

## Permissions explained

| Permission | Why |
|---|---|
| `storage` | Save highlights, notes, progress and your optional API key locally |
| `contextMenus` | The right-click "highlight selection" item |
| `sidePanel` | The library panel |
| `tabs` | Jump to a highlight in an already-open tab |
| `declarativeNetRequest` | Redirect `.pdf` links to the viewer |
| Host access (`<all_urls>`) | Run the highlighter on any site and fetch PDFs from any site |

## Known limitations

- **Scanned PDFs** (pages stored as images with no text) can't be highlighted without OCR.
- The PDF viewer fits to window width; there's no zoom yet.
- Highlights on a PDF opened from your computer are matched by file name and size, so open the same file again to see them.
- The offline summary only selects existing sentences; it can't rewrite them. Use an API key for real summaries.
- Highlights are found again by text matching, so a heavily rewritten page can lose some.
- Large PDFs load their text page by page and may take a few seconds.

## Roadmap

- [ ] Zoom and page jump in the PDF viewer
- [ ] OCR for scanned PDFs
- [ ] "Summarize whole page" and "Ask a question about this highlight"
- [ ] Highlight colors with labels (e.g. *definition*, *question*)
- [ ] Optional backend so the API key doesn't have to live in the browser
- [ ] Publish to the Chrome Web Store

## Built with

Vanilla JavaScript · Chrome Extensions Manifest V3 · [PDF.js](https://github.com/mozilla/pdf.js) · Anthropic API · developed with [Claude Code](https://www.anthropic.com/claude-code)

## License

MIT. See [LICENSE](LICENSE). PDF.js is licensed under Apache-2.0 (see `lib/PDFJS-LICENSE.txt`).
