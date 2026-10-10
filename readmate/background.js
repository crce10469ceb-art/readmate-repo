// Runs once when the extension is installed/updated.
chrome.runtime.onInstalled.addListener(() => {
  // Clicking the toolbar icon opens the side panel library.
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(console.error);

  chrome.contextMenus.create({
    id: 'readmate-highlight',
    title: 'ReadMate: highlight selection',
    contexts: ['selection']
  });
});

// Right-click > "highlight selection" -> tell the page's content script.
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'readmate-highlight' && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'HIGHLIGHT' }).catch(() => {});
  }
});

// Open any http(s) link that ends in .pdf in ReadMate's own viewer instead of Chrome's built-in one.
async function installPdfRedirect() {
  const viewer = chrome.runtime.getURL('viewer.html');
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1],
    addRules: [{
      id: 1,
      priority: 1,
      action: { type: 'redirect', redirect: { regexSubstitution: viewer + '#\\1' } },
      condition: {
        regexFilter: '^(https?://[^#?]*\\.pdf(?:\\?[^#]*)?)(?:#.*)?$',
        isUrlFilterCaseSensitive: false,
        resourceTypes: ['main_frame']
      }
    }]
  });
}
chrome.runtime.onInstalled.addListener(() => installPdfRedirect().catch(console.error));
chrome.runtime.onStartup.addListener(() => installPdfRedirect().catch(console.error));
