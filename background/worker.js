(() => {
  const browserRun = globalThis.BrowserRun || (globalThis.BrowserRun = {});
  const { getRecentQueries, saveRecentQuery } = browserRun.storage;
  const { searchEverywhere } = browserRun.providers;

  const CONTENT_SCRIPT_FILES = [
    "shared/constants.js",
    "shared/utils.js",
    "content/clipboard.js",
    "content/overlay-app.js",
    "content.js"
  ];

  chrome.commands.onCommand.addListener(async (command) => {
    if (command !== "toggle-overlay") {
      return;
    }

    try {
      await toggleOverlayOnActiveTab();
    } catch (error) {
      console.warn("Browser Run: failed to toggle overlay.", error);
    }
  });

  chrome.action.onClicked.addListener(async (tab) => {
    try {
      await toggleOverlayOnTab(tab);
    } catch (error) {
      console.warn("Browser Run: action click failed.", error);
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender)
      .then((response) => sendResponse(response))
      .catch((error) => {
        console.warn("Browser Run: runtime message failed.", error);
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Unknown error"
        });
      });

    return true;
  });

  async function handleMessage(message, sender) {
    if (!message || typeof message.type !== "string") {
      return {
        ok: false,
        error: "Некорректный запрос к расширению."
      };
    }

    switch (message.type) {
      case "PING":
        return { ok: true };
      case "SEARCH":
        return searchEverywhere(message.query || "");
      case "OPEN_RESULT":
        return openResult(message.result, message.disposition, sender);
      case "GET_RECENT_QUERIES":
        return {
          ok: true,
          recentQueries: await getRecentQueries()
        };
      case "SAVE_RECENT_QUERY":
        await saveRecentQuery(message.query || "");
        return { ok: true };
      default:
        return {
          ok: false,
          error: `Неизвестный тип сообщения: ${message.type}`
        };
    }
  }

  async function toggleOverlayOnActiveTab() {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

    if (!activeTab) {
      return;
    }

    await toggleOverlayOnTab(activeTab);
  }

  async function toggleOverlayOnTab(tab) {
    if (!tab || typeof tab.id !== "number") {
      return;
    }

    const injected = await ensureContentScript(tab.id);
    if (!injected) {
      return;
    }

    await chrome.tabs.sendMessage(tab.id, {
      type: "TOGGLE_OVERLAY"
    });
  }

  async function ensureContentScript(tabId) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: "PING" });
      return true;
    } catch (_error) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: CONTENT_SCRIPT_FILES
        });
        return true;
      } catch (injectionError) {
        console.warn("Browser Run: could not inject content script.", injectionError);
        return false;
      }
    }
  }

  async function openResult(result, disposition, sender) {
    if (!result || typeof result.url !== "string") {
      return {
        ok: false,
        error: "Некорректные данные результата."
      };
    }

    const targetDisposition = normalizeDisposition(disposition);
    const senderTabId = sender && sender.tab ? sender.tab.id : null;

    if (
      result.type === "tab"
      && targetDisposition === "current"
      && result.meta
      && typeof result.meta.tabId === "number"
    ) {
      await chrome.tabs.update(result.meta.tabId, { active: true });

      if (typeof result.meta.windowId === "number") {
        await chrome.windows.update(result.meta.windowId, { focused: true });
      }

      return { ok: true };
    }

    if (targetDisposition === "current") {
      const destinationTabId = typeof senderTabId === "number" ? senderTabId : await getActiveTabId();

      if (typeof destinationTabId !== "number") {
        return {
          ok: false,
          error: "Не удалось определить активную вкладку."
        };
      }

      await chrome.tabs.update(destinationTabId, { url: result.url });
      return { ok: true };
    }

    const openerTab = typeof senderTabId === "number"
      ? await chrome.tabs.get(senderTabId).catch(() => null)
      : null;

    const createProperties = {
      url: result.url,
      active: targetDisposition === "newForeground"
    };

    if (openerTab && typeof openerTab.windowId === "number") {
      createProperties.windowId = openerTab.windowId;

      if (typeof openerTab.index === "number") {
        createProperties.index = openerTab.index + 1;
      }
    }

    await chrome.tabs.create(createProperties);
    return { ok: true };
  }

  async function getActiveTabId() {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

    return activeTab ? activeTab.id : null;
  }

  function normalizeDisposition(disposition) {
    if (disposition === "newForeground" || disposition === "newBackground") {
      return disposition;
    }

    return "current";
  }
})();
