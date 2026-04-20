(() => {
  const browserRun = globalThis.BrowserRun || (globalThis.BrowserRun = {});
  const { SOURCE_ALIASES } = browserRun.constants;

  function sanitizeMode(mode) {
    return ["all", "tabs", "bookmarks", "history", "web", "recent"].includes(mode)
      ? mode
      : "all";
  }

  function normalize(value) {
    return String(value || "").toLowerCase().trim();
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

  function parseDirectNavigation(rawInput) {
    const trimmed = String(rawInput || "").trim();
    if (!trimmed) {
      return null;
    }

    const explicitPrefixes = ["u:", "url:", "go:"];
    const lowered = trimmed.toLowerCase();
    const prefix = explicitPrefixes.find((item) => lowered.startsWith(item));
    const candidate = prefix ? trimmed.slice(prefix.length).trim() : trimmed;

    if (!candidate || /\s/.test(candidate)) {
      return null;
    }

    if (!prefix && !looksLikeUrlCandidate(candidate)) {
      return null;
    }

    const normalizedUrl = normalizeUrlCandidate(candidate);
    if (!normalizedUrl) {
      return null;
    }

    return {
      raw: candidate,
      url: normalizedUrl,
      title: prefix ? `Open ${candidate}` : `Open ${normalizedUrl}`
    };
  }

  function looksLikeUrlCandidate(candidate) {
    return /^(https?:\/\/|ftp:\/\/|localhost(?::\d+)?(?:\/|$)|\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:\/|$)|[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?(?:\/|$))/i
      .test(candidate);
  }

  function normalizeUrlCandidate(candidate) {
    let prepared = candidate.trim();
    if (!prepared) {
      return null;
    }

    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(prepared)) {
      prepared = `https://${prepared}`;
    }

    try {
      return new URL(prepared).toString();
    } catch (_error) {
      return null;
    }
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

  function shortenUrl(url) {
    if (!url) {
      return "";
    }

    try {
      const parsed = new URL(url);
      const visible = `${parsed.hostname}${parsed.pathname}`.replace(/\/$/, "");
      return visible.length > 70 ? `${visible.slice(0, 67)}...` : visible;
    } catch (_error) {
      return url.length > 70 ? `${url.slice(0, 67)}...` : url;
    }
  }

  function resolveTheme(theme) {
    if (theme === "light" || theme === "dark") {
      return theme;
    }

    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function getResultGlyph(type) {
    switch (type) {
      case "tab":
        return "T";
      case "bookmark":
        return "B";
      case "history":
        return "H";
      case "direct":
        return "U";
      case "web":
        return "W";
      case "recent":
        return "R";
      default:
        return "?";
    }
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll("\"", "&quot;")
      .replaceAll("'", "&#39;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replaceAll("`", "&#96;");
  }

  function findIndexedResultElement(target) {
    if (!(target instanceof Element)) {
      return null;
    }

    return target.closest("[data-index]");
  }

  browserRun.utils = {
    sanitizeMode,
    normalize,
    parseScopedQuery,
    parseDirectNavigation,
    matchesQuery,
    computeScore,
    shortenUrl,
    resolveTheme,
    getResultGlyph,
    escapeHtml,
    escapeAttribute,
    findIndexedResultElement
  };
})();
