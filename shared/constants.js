(() => {
  const browserRun = globalThis.BrowserRun || (globalThis.BrowserRun = {});

  browserRun.constants = {
    DEFAULT_SETTINGS: {
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
    },
    SOURCE_ALIASES: {
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
    },
    SOURCE_LABELS: {
      all: "All",
      tabs: "Tabs",
      bookmarks: "Bookmarks",
      history: "History",
      web: "Web",
      recent: "Recent"
    },
    TYPE_LABELS: {
      tab: "Open tab",
      bookmark: "Bookmark",
      history: "History",
      direct: "Direct link",
      web: "Web search",
      recent: "Recent query"
    }
  };
})();
