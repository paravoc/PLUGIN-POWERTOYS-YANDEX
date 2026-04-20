(() => {
  const browserRun = globalThis.BrowserRun || (globalThis.BrowserRun = {});
  const { DEFAULT_SETTINGS, TYPE_LABELS } = browserRun.constants;
  const {
    normalize,
    parseScopedQuery,
    parseDirectNavigation,
    matchesQuery,
    computeScore,
    canonicalizeUrl,
    getSiteLabel,
    isTopicCandidateUrl
  } = browserRun.utils;
  const { getSettings } = browserRun.storage;

  async function searchTabs(query) {
    const normalizedQuery = normalize(query);
    const tabs = await chrome.tabs.query({});

    return tabs
      .map((tab) => {
        const title = tab.title || tab.url || "Без названия";
        const url = tab.url || "";

        if (!matchesQuery(normalizedQuery, title, url)) {
          return null;
        }

        return {
          id: `tab:${tab.id}`,
          type: "tab",
          title,
          url,
          snippet: tab.active ? "Активная вкладка в текущем окне" : "Открыть уже существующую вкладку",
          icon: tab.favIconUrl || null,
          score: computeScore(normalizedQuery, title, url) + (tab.active ? 40 : 0),
          meta: {
            tabId: tab.id,
            windowId: tab.windowId,
            active: Boolean(tab.active),
            sourceLabel: "Открытая вкладка"
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
            snippet: "Сохраненная закладка",
            icon: null,
            score: computeScore(normalizedQuery, title, url) + 10,
            meta: {
              bookmarkId: node.id,
              sourceLabel: "Закладка"
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
        maxResults: 80,
        startTime: 0
      });

      return items
        .map((item) => {
          const title = item.title || item.url || "Запись из истории";
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
            snippet: "Страница, которую вы уже открывали",
            icon: null,
            score: computeScore(normalizedQuery, title, url) + visitBoost,
            meta: {
              lastVisitTime: item.lastVisitTime || 0,
              visitCount: item.visitCount || 0,
              sourceLabel: "История"
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
        title: `Искать в интернете: "${query}"`,
        url,
        snippet: "Открыть внешнюю поисковую выдачу в выбранной вкладке.",
        icon: null,
        score: 5,
        meta: {
          sourceLabel: "Веб-поиск"
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
      snippet: "Открыть введенный адрес напрямую без промежуточного поиска.",
      icon: null,
      score: 500,
      meta: {
        sourceLabel: "Прямой переход",
        explicitCommand: directMatch.explicit
      }
    };
  }

  async function searchLocalSources(query, settings) {
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

    return (await Promise.all(tasks))
      .flat()
      .sort((left, right) => right.score - left.score);
  }

  function buildTopicResults(candidates) {
    const byUrl = new Map();

    for (const candidate of candidates) {
      if (!candidate || !candidate.url || !isTopicCandidateUrl(candidate.url)) {
        continue;
      }

      const key = canonicalizeUrl(candidate.url);
      const sourceBoost = candidate.type === "tab" ? 25 : candidate.type === "history" ? 15 : 10;
      const site = getSiteLabel(candidate.url);
      const topicResult = {
        id: `topic:${key}`,
        type: "topic",
        title: candidate.title || site || "Страница",
        url: candidate.url,
        snippet: candidate.snippet || "",
        icon: candidate.icon || null,
        score: candidate.score + sourceBoost,
        meta: {
          site,
          sourceType: candidate.type,
          sourceLabel: TYPE_LABELS[candidate.type] || candidate.meta?.sourceLabel || "Страница"
        }
      };

      const existing = byUrl.get(key);
      if (!existing || topicResult.score > existing.score) {
        byUrl.set(key, topicResult);
      }
    }

    return [...byUrl.values()]
      .sort((left, right) => right.score - left.score)
      .slice(0, 10);
  }

  async function searchTopicPages(query, settings) {
    const localCandidates = await searchLocalSources(query, settings);
    return buildTopicResults(localCandidates);
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
        results: [],
        topicResults: []
      };
    }

    let results = [];
    let topicResults = [];

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
        results = await searchLocalSources(parsed.query, settings);
        break;
    }

    if (parsed.mode !== "web") {
      topicResults = await searchTopicPages(parsed.query, settings);
    }

    if (directResult && (parsed.mode === "all" || directResult.meta.explicitCommand)) {
      results = [directResult, ...results.filter((item) => item.url !== directResult.url)];
    }

    return {
      ok: true,
      effectiveMode: parsed.mode,
      normalizedQuery: parsed.query,
      results: results.slice(0, 24),
      topicResults
    };
  }

  browserRun.providers = {
    searchTabs,
    searchBookmarks,
    searchHistory,
    buildWebResults,
    buildDirectNavigationResult,
    searchLocalSources,
    searchTopicPages,
    searchEverywhere
  };
})();
