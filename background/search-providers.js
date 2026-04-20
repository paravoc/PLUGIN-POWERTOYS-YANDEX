(() => {
  const browserRun = globalThis.BrowserRun || (globalThis.BrowserRun = {});
  const { DEFAULT_SETTINGS } = browserRun.constants;
  const {
    normalize,
    parseScopedQuery,
    parseDirectNavigation,
    matchesQuery,
    computeScore
  } = browserRun.utils;
  const { getSettings } = browserRun.storage;

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

          const visitBoost = typeof item.visitCount === "number"
            ? Math.min(item.visitCount, 20)
            : 0;

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

  function buildDirectNavigationResult(rawInput) {
    const directMatch = parseDirectNavigation(rawInput);
    if (!directMatch) {
      return null;
    }

    return {
      id: `direct:${directMatch.url}`,
      type: "direct",
      title: directMatch.title,
      url: directMatch.url,
      snippet: "Open the typed address directly without searching first.",
      icon: null,
      score: 500,
      meta: {
        sourceLabel: "Direct navigation"
      }
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

    const combined = (await Promise.all(tasks)).flat();

    if (settings.enableWebSearch) {
      combined.push(...buildWebResults(query, settings));
    }

    return combined.sort((left, right) => right.score - left.score);
  }

  async function searchEverywhere(rawInput) {
    const settings = await getSettings();
    const parsed = parseScopedQuery(rawInput, settings.defaultSource);
    const directResult = buildDirectNavigationResult(rawInput);

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

    if (directResult && parsed.mode === "all") {
      results = [directResult, ...results.filter((item) => item.url !== directResult.url)];
    }

    return {
      ok: true,
      effectiveMode: parsed.mode,
      normalizedQuery: parsed.query,
      results: results.slice(0, 24)
    };
  }

  browserRun.providers = {
    searchTabs,
    searchBookmarks,
    searchHistory,
    buildWebResults,
    buildDirectNavigationResult,
    searchAllSources,
    searchEverywhere
  };
})();
