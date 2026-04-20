(() => {
  const browserRun = globalThis.BrowserRun || (globalThis.BrowserRun = {});
  const { DEFAULT_SETTINGS } = browserRun.constants;

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
    const limit = settings.maxRecentQueries || DEFAULT_SETTINGS.maxRecentQueries;

    await chrome.storage.local.set({
      recentQueries: deduplicated.slice(0, limit)
    });
  }

  browserRun.storage = {
    getSettings,
    getRecentQueries,
    saveRecentQuery
  };
})();
