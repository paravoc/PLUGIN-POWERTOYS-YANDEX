(() => {
  const browserRun = globalThis.BrowserRun || (globalThis.BrowserRun = {});
  const { DEFAULT_SETTINGS, SOURCE_LABELS, TYPE_LABELS } = browserRun.constants;
  const {
    sanitizeMode,
    parseScopedQuery,
    shortenUrl,
    resolveTheme,
    getResultGlyph,
    escapeHtml,
    escapeAttribute,
    findIndexedResultElement
  } = browserRun.utils;
  const { copyTextToClipboard } = browserRun.clipboard;

  class BrowserRunOverlay {
    constructor() {
      this.isOpen = false;
      this.host = null;
      this.shadow = null;
      this.input = null;
      this.resultsElement = null;
      this.previewElement = null;
      this.modeBadgeElement = null;
      this.summaryElement = null;
      this.closeButton = null;
      this.loadingElement = null;
      this.results = [];
      this.selectedIndex = -1;
      this.settings = { ...DEFAULT_SETTINGS };
      this.recentQueries = [];
      this.currentMode = this.settings.defaultSource;
      this.currentQuery = "";
      this.searchTimer = null;
      this.searchSequence = 0;
      this.cssTextPromise = null;

      this.handleBackdropMouseDown = this.handleBackdropMouseDown.bind(this);
      this.handleInputEvent = this.handleInputEvent.bind(this);
      this.handleInputKeyDown = this.handleInputKeyDown.bind(this);
      this.handleResultsClick = this.handleResultsClick.bind(this);
      this.handleResultsMouseMove = this.handleResultsMouseMove.bind(this);
      this.handleDocumentKeyDown = this.handleDocumentKeyDown.bind(this);
    }

    async toggle() {
      if (this.isOpen) {
        this.close();
        return;
      }

      await this.open();
    }

    async open() {
      this.settings = await this.loadSettings();
      this.recentQueries = this.settings.rememberQueries ? await this.getRecentQueries() : [];
      this.currentMode = sanitizeMode(this.settings.defaultSource);
      this.currentQuery = "";

      const cssText = await this.loadCssText();
      this.mount(cssText);
      this.renderEmptyState();

      this.isOpen = true;
      this.input.focus();
      this.input.select();
    }

    close() {
      if (!this.isOpen) {
        return;
      }

      this.isOpen = false;
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
      this.searchSequence += 1;

      document.removeEventListener("keydown", this.handleDocumentKeyDown, true);

      if (this.host) {
        this.host.remove();
      }

      this.host = null;
      this.shadow = null;
      this.input = null;
      this.resultsElement = null;
      this.previewElement = null;
      this.modeBadgeElement = null;
      this.summaryElement = null;
      this.closeButton = null;
      this.loadingElement = null;
      this.results = [];
      this.selectedIndex = -1;
    }

    mount(cssText) {
      if (this.host) {
        this.host.remove();
      }

      this.host = document.createElement("div");
      this.host.id = "browser-run-overlay-host";
      this.host.setAttribute("data-theme", resolveTheme(this.settings.theme));
      this.shadow = this.host.attachShadow({ mode: "open" });

      const styleElement = document.createElement("style");
      styleElement.textContent = cssText;
      this.shadow.appendChild(styleElement);
      this.shadow.appendChild(this.buildTemplate());

      (document.documentElement || document.body).appendChild(this.host);

      this.input = this.shadow.querySelector("[data-role='search-input']");
      this.resultsElement = this.shadow.querySelector("[data-role='results']");
      this.previewElement = this.shadow.querySelector("[data-role='preview']");
      this.modeBadgeElement = this.shadow.querySelector("[data-role='mode-badge']");
      this.summaryElement = this.shadow.querySelector("[data-role='summary']");
      this.closeButton = this.shadow.querySelector("[data-role='close-button']");
      this.loadingElement = this.shadow.querySelector("[data-role='loading']");

      this.shadow.querySelector("[data-role='backdrop']").addEventListener("mousedown", this.handleBackdropMouseDown);
      this.input.addEventListener("input", this.handleInputEvent);
      this.input.addEventListener("keydown", this.handleInputKeyDown);
      this.resultsElement.addEventListener("click", this.handleResultsClick);
      this.resultsElement.addEventListener("mousemove", this.handleResultsMouseMove);
      this.closeButton.addEventListener("click", () => this.close());
      document.addEventListener("keydown", this.handleDocumentKeyDown, true);

      this.shadow.querySelector("[data-role='open-current']").addEventListener("click", () => {
        this.openSelected(this.defaultDisposition());
      });
      this.shadow.querySelector("[data-role='open-new']").addEventListener("click", () => {
        this.openSelected("newForeground");
      });
      this.shadow.querySelector("[data-role='copy-link']").addEventListener("click", () => {
        this.copySelectedLink();
      });

      this.updateModeBadge(this.settings.defaultSource);
    }

    buildTemplate() {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = `
        <div class="br-backdrop" data-role="backdrop">
          <section class="br-shell" role="dialog" aria-modal="true" aria-label="Browser Run overlay">
            <header class="br-header">
              <div class="br-brand">
                <div class="br-brand-mark">BR</div>
                <div class="br-brand-copy">
                  <div class="br-title">Browser Run</div>
                  <div class="br-subtitle">Command palette for tabs, bookmarks and history</div>
                </div>
                <div class="br-mode-badge" data-role="mode-badge">All</div>
              </div>
              <div class="br-search-row">
                <input
                  class="br-search-input"
                  data-role="search-input"
                  type="text"
                  spellcheck="false"
                  autocomplete="off"
                  placeholder="Search anything... Use t:, b:, h:, w:, u:"
                  aria-label="Search"
                />
                <button class="br-icon-button" data-role="close-button" type="button" aria-label="Close overlay">Esc</button>
              </div>
            </header>

            <div class="br-content">
              <section class="br-results-pane">
                <div class="br-loading" data-role="loading" hidden>Searching...</div>
                <div class="br-results" data-role="results" role="listbox" aria-label="Search results"></div>
              </section>

              <aside class="br-preview-pane">
                <div class="br-preview" data-role="preview"></div>
                <div class="br-preview-actions">
                  <button class="br-action-button" data-role="open-current" type="button">Open</button>
                  <button class="br-action-button" data-role="open-new" type="button">New tab</button>
                  <button class="br-action-button" data-role="copy-link" type="button">Copy link</button>
                </div>
              </aside>
            </div>

            <footer class="br-footer">
              <div class="br-summary" data-role="summary">Ready</div>
              <div class="br-hints">
                <span>Enter open</span>
                <span>Ctrl+Enter new tab</span>
                <span>Shift+Enter background</span>
                <span>Esc close</span>
              </div>
            </footer>
          </section>
        </div>
      `;

      return wrapper.firstElementChild;
    }

    handleBackdropMouseDown(event) {
      if (event.target === event.currentTarget) {
        this.close();
      }
    }

    handleInputEvent() {
      const rawValue = this.input.value || "";
      const scoped = parseScopedQuery(rawValue, this.settings.defaultSource);

      this.currentMode = scoped.mode;
      this.currentQuery = scoped.query;
      this.updateModeBadge(scoped.mode);

      clearTimeout(this.searchTimer);
      this.searchTimer = null;

      if (!rawValue.trim()) {
        this.renderEmptyState();
        return;
      }

      this.loadingElement.hidden = false;
      this.searchTimer = window.setTimeout(() => {
        this.executeSearch(rawValue);
      }, 180);
    }

    async executeSearch(query) {
      const sequence = ++this.searchSequence;

      try {
        const response = await chrome.runtime.sendMessage({
          type: "SEARCH",
          query
        });

        if (!this.isOpen || sequence !== this.searchSequence) {
          return;
        }

        if (!response || response.ok === false) {
          this.results = [];
          this.selectedIndex = -1;
          this.loadingElement.hidden = true;
          this.renderError(response && response.error ? response.error : "Search failed.");
          return;
        }

        this.loadingElement.hidden = true;
        this.currentMode = response.effectiveMode || this.currentMode;
        this.currentQuery = response.normalizedQuery || "";
        this.updateModeBadge(this.currentMode);

        this.results = Array.isArray(response.results) ? response.results : [];
        this.selectedIndex = this.results.length > 0 ? 0 : -1;
        this.renderResults();
      } catch (error) {
        if (!this.isOpen || sequence !== this.searchSequence) {
          return;
        }

        this.loadingElement.hidden = true;
        this.results = [];
        this.selectedIndex = -1;
        this.renderError(error instanceof Error ? error.message : "Search failed.");
      }
    }

    renderEmptyState() {
      this.loadingElement.hidden = true;

      if (this.settings.rememberQueries && this.recentQueries.length > 0) {
        this.results = this.recentQueries.map((query, index) => ({
          id: `recent:${index}:${query}`,
          type: "recent",
          title: query,
          url: "",
          snippet: "Repeat recent query",
          icon: null,
          score: 100 - index,
          meta: {
            query,
            sourceLabel: "Recent query"
          }
        }));
        this.selectedIndex = 0;
        this.renderResults();
        return;
      }

      this.results = [];
      this.selectedIndex = -1;
      this.resultsElement.innerHTML = `
        <div class="br-state-card">
          <div class="br-state-title">Start typing to search</div>
          <div class="br-state-copy">Use <span>t:</span> for tabs, <span>b:</span> for bookmarks, <span>h:</span> for history, <span>w:</span> for web, <span>u:</span> for direct URL.</div>
        </div>
      `;
      this.previewElement.innerHTML = `
        <div class="br-preview-empty">
          <div class="br-preview-title">Quick start</div>
          <div class="br-preview-copy">The first result is selected automatically. Use arrow keys to switch results and Enter to open.</div>
        </div>
      `;
      this.summaryElement.textContent = "Type to search local browser sources";
    }

    renderError(message) {
      this.resultsElement.innerHTML = `
        <div class="br-state-card">
          <div class="br-state-title">Search error</div>
          <div class="br-state-copy">${escapeHtml(message)}</div>
        </div>
      `;
      this.previewElement.innerHTML = `
        <div class="br-preview-empty">
          <div class="br-preview-title">No preview available</div>
          <div class="br-preview-copy">Check permissions or try another query.</div>
        </div>
      `;
      this.summaryElement.textContent = "Search error";
    }

    renderResults() {
      if (!this.results.length) {
        this.resultsElement.innerHTML = `
          <div class="br-state-card">
            <div class="br-state-title">No results</div>
            <div class="br-state-copy">Try another query or switch the source prefix.</div>
          </div>
        `;
        this.previewElement.innerHTML = `
          <div class="br-preview-empty">
            <div class="br-preview-title">Nothing selected</div>
            <div class="br-preview-copy">No matching items were found in the current source.</div>
          </div>
        `;
        this.summaryElement.textContent = `No results in ${SOURCE_LABELS[this.currentMode] || "current source"}`;
        return;
      }

      this.resultsElement.innerHTML = this.results
        .map((result, index) => this.renderResultItem(result, index, index === this.selectedIndex))
        .join("");

      this.renderPreview();
      this.summaryElement.textContent = `${this.results.length} result${this.results.length === 1 ? "" : "s"} in ${SOURCE_LABELS[this.currentMode] || "current source"}`;
    }

    renderResultItem(result, index, isSelected) {
      const iconMarkup = result.icon
        ? `<img class="br-result-icon-image" src="${escapeAttribute(result.icon)}" alt="" />`
        : `<div class="br-result-icon-fallback">${escapeHtml(getResultGlyph(result.type))}</div>`;

      const metaLine = result.url
        ? `<div class="br-result-url">${escapeHtml(shortenUrl(result.url))}</div>`
        : `<div class="br-result-url br-result-url-muted">${escapeHtml(TYPE_LABELS[result.type] || "Result")}</div>`;

      const snippet = result.snippet
        ? `<div class="br-result-snippet">${escapeHtml(result.snippet)}</div>`
        : "";

      return `
        <button
          class="br-result-item${isSelected ? " is-selected" : ""}"
          type="button"
          role="option"
          aria-selected="${isSelected ? "true" : "false"}"
          data-index="${index}"
        >
          <div class="br-result-icon">${iconMarkup}</div>
          <div class="br-result-copy">
            <div class="br-result-title">${escapeHtml(result.title || "Untitled result")}</div>
            ${metaLine}
            ${snippet}
          </div>
          <div class="br-result-type">${escapeHtml(TYPE_LABELS[result.type] || "Result")}</div>
        </button>
      `;
    }

    renderPreview() {
      const result = this.results[this.selectedIndex];

      if (!result) {
        this.previewElement.innerHTML = `
          <div class="br-preview-empty">
            <div class="br-preview-title">Nothing selected</div>
            <div class="br-preview-copy">Move through results with ArrowUp and ArrowDown.</div>
          </div>
        `;
        return;
      }

      const lines = [];

      if (result.type === "tab" && result.meta && result.meta.active) {
        lines.push("Active tab");
      }

      if (result.type === "recent") {
        lines.push("Press Enter to repeat this query");
      } else if (result.url) {
        lines.push(result.url);
      }

      if (result.meta && result.meta.sourceLabel) {
        lines.push(result.meta.sourceLabel);
      }

      this.previewElement.innerHTML = `
        <div class="br-preview-card">
          <div class="br-preview-type">${escapeHtml(TYPE_LABELS[result.type] || "Result")}</div>
          <div class="br-preview-title">${escapeHtml(result.title || "Untitled result")}</div>
          <div class="br-preview-url">${escapeHtml(shortenUrl(result.url || lines[0] || ""))}</div>
          <div class="br-preview-copy">${escapeHtml(result.snippet || "Open this result using the selected action.")}</div>
          <div class="br-preview-meta">
            ${lines.map((line) => `<span>${escapeHtml(line)}</span>`).join("")}
          </div>
        </div>
      `;
    }

    handleResultsClick(event) {
      const item = findIndexedResultElement(event.target);
      if (!item) {
        return;
      }

      const index = Number(item.getAttribute("data-index"));
      if (Number.isNaN(index)) {
        return;
      }

      this.selectedIndex = index;
      this.renderResults();
      this.openSelected(this.defaultDisposition());
    }

    handleResultsMouseMove(event) {
      const item = findIndexedResultElement(event.target);
      if (!item) {
        return;
      }

      const index = Number(item.getAttribute("data-index"));
      if (Number.isNaN(index) || index === this.selectedIndex) {
        return;
      }

      this.selectedIndex = index;
      this.renderResults();
    }

    handleDocumentKeyDown(event) {
      if (!this.isOpen) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.close();
      }
    }

    async handleInputKeyDown(event) {
      if (!this.isOpen) {
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        this.moveSelection(1);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        this.moveSelection(-1);
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();

        let disposition = this.defaultDisposition();
        if (event.ctrlKey || event.metaKey) {
          disposition = "newForeground";
        } else if (event.shiftKey) {
          disposition = "newBackground";
        }

        await this.openSelected(disposition);
      }
    }

    moveSelection(step) {
      if (!this.results.length) {
        return;
      }

      const nextIndex = this.selectedIndex < 0
        ? 0
        : (this.selectedIndex + step + this.results.length) % this.results.length;

      this.selectedIndex = nextIndex;
      this.renderResults();

      const selectedItem = this.resultsElement.querySelector(`[data-index="${nextIndex}"]`);
      if (selectedItem) {
        selectedItem.scrollIntoView({
          block: "nearest",
          behavior: "smooth"
        });
      }
    }

    async openSelected(disposition) {
      const selectedResult = this.results[this.selectedIndex];
      if (!selectedResult) {
        return;
      }

      if (selectedResult.type === "recent") {
        this.input.value = selectedResult.meta.query;
        this.input.dispatchEvent(new Event("input", { bubbles: true }));
        this.input.focus();
        return;
      }

      const effectiveDisposition = disposition || this.defaultDisposition();
      const queryToSave = this.currentQuery || this.input.value.trim();

      if (queryToSave) {
        await chrome.runtime.sendMessage({
          type: "SAVE_RECENT_QUERY",
          query: queryToSave
        });

        this.recentQueries = [
          queryToSave,
          ...this.recentQueries.filter((item) => item !== queryToSave)
        ].slice(0, this.settings.maxRecentQueries);
      }

      const response = await chrome.runtime.sendMessage({
        type: "OPEN_RESULT",
        result: selectedResult,
        disposition: effectiveDisposition
      });

      if (!response || response.ok === false) {
        this.summaryElement.textContent = response && response.error ? response.error : "Open action failed";
        return;
      }

      if (this.settings.closeOnOpen) {
        this.close();
      }
    }

    async copySelectedLink() {
      const selectedResult = this.results[this.selectedIndex];
      if (!selectedResult || !selectedResult.url) {
        return;
      }

      const copied = await copyTextToClipboard(selectedResult.url, this.shadow);
      this.summaryElement.textContent = copied ? "Link copied to clipboard" : "Copy failed";
    }

    defaultDisposition() {
      return this.settings.enterBehavior === "new-tab" ? "newForeground" : "current";
    }

    updateModeBadge(mode) {
      if (this.modeBadgeElement) {
        this.modeBadgeElement.textContent = SOURCE_LABELS[sanitizeMode(mode)] || "All";
      }
    }

    async loadSettings() {
      const { settings } = await chrome.storage.local.get({
        settings: DEFAULT_SETTINGS
      });

      return {
        ...DEFAULT_SETTINGS,
        ...(settings || {})
      };
    }

    async getRecentQueries() {
      const { recentQueries } = await chrome.storage.local.get({
        recentQueries: []
      });

      return Array.isArray(recentQueries) ? recentQueries : [];
    }

    async loadCssText() {
      if (!this.cssTextPromise) {
        this.cssTextPromise = fetch(chrome.runtime.getURL("overlay.css")).then((response) => response.text());
      }

      return this.cssTextPromise;
    }
  }

  browserRun.content = {
    BrowserRunOverlay
  };
})();
