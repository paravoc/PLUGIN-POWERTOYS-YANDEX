const DEFAULT_SETTINGS = {
  defaultSource: "all",
  enableTabsSearch: true,
  enableBookmarksSearch: true,
  enableHistorySearch: true,
  enableWebSearch: true,
  enterBehavior: "current-tab",
  rememberQueries: true,
  closeOnOpen: true,
  theme: "auto",
  maxRecentQueries: 20,
  webSearchUrl: "https://yandex.ru/search/?text=%s"
};

const SOURCE_ALIASES = {
  t: "tabs",
  tab: "tabs",
  tabs: "tabs",
  b: "bookmarks",
  bookmark: "bookmarks",
  bookmarks: "bookmarks",
  h: "history",
  history: "history",
  w: "web",
  web: "web",
  a: "all",
  all: "all"
};

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
      error: "Invalid message payload."
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
        error: `Unknown message type: ${message.type}`
      };
  }
}

async function toggleOverlayOnActiveTab() {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!activeTab || typeof activeTab.id !== "number") {
    return;
  }

  const injected = await ensureContentScript(activeTab.id);
  if (!injected) {
    return;
  }

  await chrome.tabs.sendMessage(activeTab.id, {
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
        files: ["content.js"]
      });
      return true;
    } catch (injectionError) {
      console.warn("Browser Run: could not inject content script.", injectionError);
      return false;
    }
  }
}

async function searchEverywhere(rawInput) {
  const settings = await getSettings();
  const parsed = parseScopedQuery(rawInput, settings.defaultSource);

  if (!parsed.query) {
    return {
      ok: true,
      effectiveMode: parsed.mode,
      normalizedQuery: "",
      results: []
    };
  }

  let results = [];

  switch (parsed.mode) {
    case "tabs":
      results = settings.enableTabsSearch ? await searchTabs(parsed.query) : [];
      break;
    case "bookmarks":
      results = settings.enableBookmarksSearch ? await searchBookmarks(parsed.query) : [];
      break;
    case "history":
      results = settings.enableHistorySearch ? await searchHistory(parsed.query) : [];
      break;
    case "web":
      results = settings.enableWebSearch ? buildWebResults(parsed.query, settings) : [];
      break;
    case "all":
    default:
      results = await searchAllSources(parsed.query, settings);
      break;
  }

  return {
    ok: true,
    effectiveMode: parsed.mode,
    normalizedQuery: parsed.query,
    results: results.slice(0, 24)
  };
}

async function searchAllSources(query, settings) {
  const tasks = [];

  if (settings.enableTabsSearch) {
    tasks.push(searchTabs(query));
  }

  if (settings.enableBookmarksSearch) {
    tasks.push(searchBookmarks(query));
  }

  if (settings.enableHistorySearch) {
    tasks.push(searchHistory(query));
  }

  const settled = await Promise.all(tasks);
  const combined = settled.flat();

  if (settings.enableWebSearch) {
    combined.push(...buildWebResults(query, settings));
  }

  return combined.sort((left, right) => right.score - left.score);
}

async function searchTabs(query) {
  const normalizedQuery = normalize(query);
  const tabs = await chrome.tabs.query({});

  return tabs
    .map((tab) => {
      const title = tab.title || tab.url || "Untitled tab";
      const url = tab.url || "";

      if (!matchesQuery(normalizedQuery, title, url)) {
        return null;
      }

      return {
        id: `tab:${tab.id}`,
        type: "tab",
        title,
        url,
        snippet: tab.active ? "Open tab in focused window" : "Open existing browser tab",
        icon: tab.favIconUrl || null,
        score: computeScore(normalizedQuery, title, url) + (tab.active ? 40 : 0),
        meta: {
          tabId: tab.id,
          windowId: tab.windowId,
          active: Boolean(tab.active),
          sourceLabel: "Open tab"
        }
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score);
}

async function searchBookmarks(query) {
  const normalizedQuery = normalize(query);

  try {
    const nodes = await chrome.bookmarks.search(query);

    return nodes
      .filter((node) => typeof node.url === "string" && node.url.length > 0)
      .map((node) => {
        const title = node.title || node.url;
        const url = node.url || "";

        if (!matchesQuery(normalizedQuery, title, url)) {
          return null;
        }

        return {
          id: `bookmark:${node.id}`,
          type: "bookmark",
          title,
          url,
          snippet: "Bookmark",
          icon: null,
          score: computeScore(normalizedQuery, title, url) + 10,
          meta: {
            bookmarkId: node.id,
            sourceLabel: "Bookmark"
          }
        };
      })
      .filter(Boolean)
      .sort((left, right) => right.score - left.score);
  } catch (error) {
    console.warn("Browser Run: bookmark search failed.", error);
    return [];
  }
}

async function searchHistory(query) {
  const normalizedQuery = normalize(query);

  try {
    const items = await chrome.history.search({
      text: query,
      maxResults: 50,
      startTime: 0
    });

    return items
      .map((item) => {
        const title = item.title || item.url || "History entry";
        const url = item.url || "";

        if (!url || !matchesQuery(normalizedQuery, title, url)) {
          return null;
        }

        const visitBoost = typeof item.visitCount === "number" ? Math.min(item.visitCount, 20) : 0;

        return {
          id: `history:${url}`,
          type: "history",
          title,
          url,
          snippet: "Previously visited page",
          icon: null,
          score: computeScore(normalizedQuery, title, url) + visitBoost,
          meta: {
            lastVisitTime: item.lastVisitTime || 0,
            visitCount: item.visitCount || 0,
            sourceLabel: "History"
          }
        };
      })
      .filter(Boolean)
      .sort((left, right) => right.score - left.score);
  } catch (error) {
    console.warn("Browser Run: history search failed.", error);
    return [];
  }
}

function buildWebResults(query, settings) {
  const template = typeof settings.webSearchUrl === "string" && settings.webSearchUrl.includes("%s")
    ? settings.webSearchUrl
    : DEFAULT_SETTINGS.webSearchUrl;
  const url = template.replace("%s", encodeURIComponent(query));

  return [
    {
      id: `web:${query}`,
      type: "web",
      title: `Search the web for "${query}"`,
      url,
      snippet: "Open external search results in the selected browser tab.",
      icon: null,
      score: 5,
      meta: {
        sourceLabel: "Web search"
      }
    }
  ];
}

async function openResult(result, disposition, sender) {
  if (!result || typeof result.url !== "string") {
    return {
      ok: false,
      error: "Result payload is invalid."
    };
  }

  const targetDisposition = normalizeDisposition(disposition);
  const senderTabId = sender && sender.tab ? sender.tab.id : null;

  if (result.type === "tab" && targetDisposition === "current" && result.meta && typeof result.meta.tabId === "number") {
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
        error: "Could not determine the active tab."
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

function parseScopedQuery(rawInput, defaultSource) {
  const trimmed = typeof rawInput === "string" ? rawInput.trim() : "";
  if (!trimmed) {
    return {
      mode: sanitizeMode(defaultSource),
      query: ""
    };
  }

  const separatorIndex = trimmed.indexOf(":");
  if (separatorIndex > 0) {
    const prefix = normalize(trimmed.slice(0, separatorIndex));
    const mappedMode = SOURCE_ALIASES[prefix];

    if (mappedMode) {
      return {
        mode: mappedMode,
        query: trimmed.slice(separatorIndex + 1).trim()
      };
    }
  }

  return {
    mode: sanitizeMode(defaultSource),
    query: trimmed
  };
}

function sanitizeMode(mode) {
  return ["all", "tabs", "bookmarks", "history", "web"].includes(mode) ? mode : "all";
}

function matchesQuery(normalizedQuery, title, url) {
  const haystack = `${normalize(title)} ${normalize(url)}`;
  return haystack.includes(normalizedQuery);
}

function computeScore(normalizedQuery, title, url) {
  const normalizedTitle = normalize(title);
  const normalizedUrl = normalize(url);
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  let score = 0;

  if (normalizedTitle.startsWith(normalizedQuery)) {
    score += 80;
  }

  if (normalizedUrl.startsWith(normalizedQuery)) {
    score += 50;
  }

  for (const token of tokens) {
    if (normalizedTitle.includes(token)) {
      score += 25;
    }

    if (normalizedUrl.includes(token)) {
      score += 10;
    }
  }

  return score;
}

function normalize(value) {
  return String(value || "").toLowerCase().trim();
}

async function getSettings() {
  const { settings } = await chrome.storage.local.get({
    settings: DEFAULT_SETTINGS
  });

  return {
    ...DEFAULT_SETTINGS,
    ...(settings || {})
  };
}

async function getRecentQueries() {
  const settings = await getSettings();
  if (!settings.rememberQueries) {
    return [];
  }

  const { recentQueries } = await chrome.storage.local.get({
    recentQueries: []
  });

  return Array.isArray(recentQueries) ? recentQueries : [];
}

async function saveRecentQuery(rawQuery) {
  const query = String(rawQuery || "").trim();
  if (!query) {
    return;
  }

  const settings = await getSettings();
  if (!settings.rememberQueries) {
    return;
  }

  const existingQueries = await getRecentQueries();
  const deduplicated = [query, ...existingQueries.filter((item) => item !== query)];
  const limited = deduplicated.slice(0, settings.maxRecentQueries || DEFAULT_SETTINGS.maxRecentQueries);

  await chrome.storage.local.set({
    recentQueries: limited
  });
}
