(() => {
  if (globalThis.__browserRunOverlayLoaded) {
    return;
  }

  globalThis.__browserRunOverlayLoaded = true;

  const browserRun = globalThis.BrowserRun || (globalThis.BrowserRun = {});
  const { BrowserRunOverlay } = browserRun.content;
  const overlay = new BrowserRunOverlay();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== "string") {
      sendResponse({ ok: false });
      return false;
    }

    if (message.type === "PING") {
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === "TOGGLE_OVERLAY") {
      overlay.toggle()
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Unknown error"
        }));

      return true;
    }

    sendResponse({ ok: false });
    return false;
  });
})();
