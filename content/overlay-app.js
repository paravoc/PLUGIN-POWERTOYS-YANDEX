(() => {
  const browserRun = globalThis.BrowserRun || (globalThis.BrowserRun = {});
  const { DEFAULT_SETTINGS, SOURCE_LABELS, TYPE_LABELS } = browserRun.constants;
  const {
    sanitizeMode,
    parseScopedQuery,
    shortenUrl,
    getSiteLabel,
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
      this.topicListElement = null;
      this.topicSummaryElement = null;
      this.modeBadgeElement = null;
      this.summaryElement = null;
      this.closeButton = null;
      this.loadingElement = null;
      this.results = [];
      this.topicResults = [];
      this.selectedIndex = -1;
      this.topicSelectedIndex = -1;
      this.activePane = "local";
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
      this.handleTopicListClick = this.handleTopicListClick.bind(this);
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
      this.topicListElement = null;
      this.topicSummaryElement = null;
      this.modeBadgeElement = null;
      this.summaryElement = null;
      this.closeButton = null;
      this.loadingElement = null;
      this.results = [];
      this.topicResults = [];
      this.selectedIndex = -1;
      this.topicSelectedIndex = -1;
      this.activePane = "local";
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
      this.topicListElement = this.shadow.querySelector("[data-role='topic-list']");
      this.topicSummaryElement = this.shadow.querySelector("[data-role='topic-summary']");
      this.modeBadgeElement = this.shadow.querySelector("[data-role='mode-badge']");
      this.summaryElement = this.shadow.querySelector("[data-role='summary']");
      this.closeButton = this.shadow.querySelector("[data-role='close-button']");
      this.loadingElement = this.shadow.querySelector("[data-role='loading']");

      this.shadow.querySelector("[data-role='backdrop']").addEventListener("mousedown", this.handleBackdropMouseDown);
      this.input.addEventListener("input", this.handleInputEvent);
      this.input.addEventListener("keydown", this.handleInputKeyDown);
      this.resultsElement.addEventListener("click", this.handleResultsClick);
      this.resultsElement.addEventListener("mousemove", this.handleResultsMouseMove);
      this.topicListElement.addEventListener("click", this.handleTopicListClick);
      this.closeButton.addEventListener("click", () => this.close());
      document.addEventListener("keydown", this.handleDocumentKeyDown, true);

      this.shadow.querySelector("[data-role='open-current']").addEventListener("click", () => {
        this.openFocusedResult(this.defaultDisposition());
      });
      this.shadow.querySelector("[data-role='open-new']").addEventListener("click", () => {
        this.openFocusedResult("newForeground");
      });
      this.shadow.querySelector("[data-role='copy-link']").addEventListener("click", () => {
        this.copyFocusedLink();
      });

      this.updateModeBadge(this.settings.defaultSource);
    }

    buildTemplate() {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = `
        <div class="br-backdrop" data-role="backdrop">
          <section class="br-shell" role="dialog" aria-modal="true" aria-label="Окно быстрого поиска Browser Run">
            <header class="br-header">
              <div class="br-brand">
                <div class="br-brand-mark">BR</div>
                <div class="br-brand-copy">
                  <div class="br-title">Browser Run</div>
                  <div class="br-subtitle">Слева локальный поиск, справа страницы по теме</div>
                </div>
                <div class="br-mode-badge" data-role="mode-badge">Все</div>
              </div>
              <div class="br-search-row">
                <input
                  class="br-search-input"
                  data-role="search-input"
                  type="text"
                  spellcheck="false"
                  autocomplete="off"
                  placeholder="Ищи локально... t:, b:, h:, w:, u:"
                  aria-label="Поиск"
                />
                <button class="br-icon-button" data-role="close-button" type="button" aria-label="Закрыть окно">Esc</button>
              </div>
            </header>

            <div class="br-content">
              <section class="br-results-pane">
                <div class="br-loading" data-role="loading" hidden>Идёт поиск...</div>
                <div class="br-results" data-role="results" role="listbox" aria-label="Локальные результаты"></div>
              </section>

              <aside class="br-preview-pane">
                <div class="br-preview" data-role="preview"></div>
                <section class="br-topic-pane">
                  <div class="br-topic-header">
                    <div class="br-topic-title">Страницы по теме</div>
                    <div class="br-topic-subtitle" data-role="topic-summary">До 10 локальных страниц</div>
                  </div>
                  <div class="br-topic-list" data-role="topic-list"></div>
                </section>
                <div class="br-preview-actions">
                  <button class="br-action-button" data-role="open-current" type="button">Открыть</button>
                  <button class="br-action-button" data-role="open-new" type="button">Новая вкладка</button>
                  <button class="br-action-button" data-role="copy-link" type="button">Копировать ссылку</button>
                </div>
              </aside>
            </div>

            <footer class="br-footer">
              <div class="br-summary" data-role="summary">Готово</div>
              <div class="br-hints">
                <span>Enter открыть слева</span>
                <span>Ctrl+Enter новая вкладка</span>
                <span>Клик справа выбрать сайт</span>
                <span>Esc закрыть</span>
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
          this.topicResults = [];
          this.selectedIndex = -1;
          this.topicSelectedIndex = -1;
          this.loadingElement.hidden = true;
          this.renderError(response && response.error ? response.error : "Не удалось выполнить поиск.");
          return;
        }

        this.loadingElement.hidden = true;
        this.currentMode = response.effectiveMode || this.currentMode;
        this.currentQuery = response.normalizedQuery || "";
        this.updateModeBadge(this.currentMode);

        this.results = Array.isArray(response.results) ? response.results : [];
        this.topicResults = Array.isArray(response.topicResults) ? response.topicResults.slice(0, 10) : [];
        this.selectedIndex = this.results.length > 0 ? 0 : -1;
        this.topicSelectedIndex = this.topicResults.length > 0 ? 0 : -1;
        this.activePane = this.results.length > 0 ? "local" : this.topicResults.length > 0 ? "topic" : "local";
        this.renderResults();
      } catch (error) {
        if (!this.isOpen || sequence !== this.searchSequence) {
          return;
        }

        this.loadingElement.hidden = true;
        this.results = [];
        this.topicResults = [];
        this.selectedIndex = -1;
        this.topicSelectedIndex = -1;
        this.renderError(error instanceof Error ? error.message : "Не удалось выполнить поиск.");
      }
    }

    renderEmptyState() {
      this.loadingElement.hidden = true;
      this.topicResults = [];
      this.topicSelectedIndex = -1;
      this.activePane = "local";

      if (this.settings.rememberQueries && this.recentQueries.length > 0) {
        this.results = this.recentQueries.map((query, index) => ({
          id: `recent:${index}:${query}`,
          type: "recent",
          title: query,
          url: "",
          snippet: "Повторить недавний запрос",
          icon: null,
          score: 100 - index,
          meta: {
            query,
            sourceLabel: "Недавний запрос"
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
          <div class="br-state-title">Начните вводить запрос</div>
          <div class="br-state-copy">Слева появятся локальные результаты из вкладок, закладок и истории. Справа будут страницы по теме из браузера.</div>
        </div>
      `;
      this.previewElement.innerHTML = `
        <div class="br-preview-empty">
          <div class="br-preview-title">Локальный поиск</div>
          <div class="br-preview-copy">Введите тему, например «коты». Слева будет локальный поиск, а справа — похожие страницы, которые уже встречались в браузере.</div>
        </div>
      `;
      this.renderTopicResults();
      this.summaryElement.textContent = "Начните ввод, чтобы искать по браузеру";
    }

    renderError(message) {
      this.resultsElement.innerHTML = `
        <div class="br-state-card">
          <div class="br-state-title">Ошибка поиска</div>
          <div class="br-state-copy">${escapeHtml(message)}</div>
        </div>
      `;
      this.previewElement.innerHTML = `
        <div class="br-preview-empty">
          <div class="br-preview-title">Предпросмотр недоступен</div>
          <div class="br-preview-copy">Проверьте разрешения расширения и попробуйте другой запрос.</div>
        </div>
      `;
      this.renderTopicResults();
      this.summaryElement.textContent = "Ошибка поиска";
    }

    renderResults() {
      if (!this.results.length) {
        this.resultsElement.innerHTML = `
          <div class="br-state-card">
            <div class="br-state-title">Локально ничего не найдено</div>
            <div class="br-state-copy">Попробуйте другой запрос или смените источник слева через префикс.</div>
          </div>
        `;
      } else {
        this.resultsElement.innerHTML = this.results
          .map((result, index) => this.renderResultItem(result, index, index === this.selectedIndex))
          .join("");
      }

      this.renderPreview();
      this.renderTopicResults();
      this.summaryElement.textContent = `Слева: ${this.formatResultCount(this.results.length)}. Справа: ${this.formatResultCount(this.topicResults.length)}.`;
    }

    renderResultItem(result, index, isSelected) {
      const iconMarkup = result.icon
        ? `<img class="br-result-icon-image" src="${escapeAttribute(result.icon)}" alt="" />`
        : `<div class="br-result-icon-fallback">${escapeHtml(getResultGlyph(result.type))}</div>`;

      const metaLine = result.url
        ? `<div class="br-result-url">${escapeHtml(shortenUrl(result.url))}</div>`
        : `<div class="br-result-url br-result-url-muted">${escapeHtml(TYPE_LABELS[result.type] || "Результат")}</div>`;

      const snippet = result.snippet
        ? `<div class="br-result-snippet">${escapeHtml(result.snippet)}</div>`
        : "";

      return `
        <button
          class="br-result-item${isSelected && this.activePane === "local" ? " is-selected" : ""}"
          type="button"
          role="option"
          aria-selected="${isSelected ? "true" : "false"}"
          data-index="${index}"
        >
          <div class="br-result-icon">${iconMarkup}</div>
          <div class="br-result-copy">
            <div class="br-result-title">${escapeHtml(result.title || "Без названия")}</div>
            ${metaLine}
            ${snippet}
          </div>
          <div class="br-result-type">${escapeHtml(TYPE_LABELS[result.type] || "Результат")}</div>
        </button>
      `;
    }

    renderPreview() {
      const result = this.getFocusedResult();

      if (!result) {
        this.previewElement.innerHTML = `
          <div class="br-preview-empty">
            <div class="br-preview-title">Нет выбранного результата</div>
            <div class="br-preview-copy">Выберите элемент слева или страницу по теме справа.</div>
          </div>
        `;
        return;
      }

      const lines = [];

      if (result.type === "tab" && result.meta && result.meta.active) {
        lines.push("Активная вкладка");
      }

      if (result.type === "recent") {
        lines.push("Нажмите Enter, чтобы повторить запрос");
      } else if (result.url) {
        lines.push(result.url);
      }

      if (result.meta && result.meta.sourceLabel) {
        lines.push(result.meta.sourceLabel);
      }

      if (result.meta && result.meta.site) {
        lines.push(result.meta.site);
      }

      this.previewElement.innerHTML = `
        <div class="br-preview-card">
          <div class="br-preview-type">${escapeHtml(TYPE_LABELS[result.type] || "Результат")}</div>
          <div class="br-preview-title">${escapeHtml(result.title || "Без названия")}</div>
          <div class="br-preview-url">${escapeHtml(shortenUrl(result.url || lines[0] || ""))}</div>
          <div class="br-preview-copy">${escapeHtml(result.snippet || "Используйте кнопки ниже, чтобы открыть или скопировать ссылку.")}</div>
          <div class="br-preview-meta">
            ${lines.map((line) => `<span>${escapeHtml(line)}</span>`).join("")}
          </div>
        </div>
      `;
    }

    renderTopicResults() {
      if (!this.topicListElement || !this.topicSummaryElement) {
        return;
      }

      this.topicSummaryElement.textContent = this.topicResults.length > 0
        ? `${this.formatResultCount(this.topicResults.length)} по теме`
        : "Нет тематических страниц";

      if (!this.topicResults.length) {
        this.topicListElement.innerHTML = `
          <div class="br-topic-empty">
            По этому запросу в истории, вкладках и закладках пока нет тематических страниц.
          </div>
        `;
        return;
      }

      this.topicListElement.innerHTML = this.topicResults
        .map((result, index) => `
          <button
            class="br-topic-item${this.activePane === "topic" && index === this.topicSelectedIndex ? " is-selected" : ""}"
            type="button"
            data-index="${index}"
          >
            <div class="br-topic-item-title">${escapeHtml(result.title || "Без названия")}</div>
            <div class="br-topic-item-site">${escapeHtml(result.meta?.site || getSiteLabel(result.url))}</div>
          </button>
        `)
        .join("");
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

      this.activePane = "local";
      this.selectedIndex = index;
      this.renderResults();
      this.openLocalSelected(this.defaultDisposition());
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

      this.activePane = "local";
      this.selectedIndex = index;
      this.renderResults();
    }

    handleTopicListClick(event) {
      const item = findIndexedResultElement(event.target);
      if (!item) {
        return;
      }

      const index = Number(item.getAttribute("data-index"));
      if (Number.isNaN(index) || !this.topicResults[index]) {
        return;
      }

      this.activePane = "topic";
      this.topicSelectedIndex = index;
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

        await this.openLocalSelected(disposition);
      }
    }

    moveSelection(step) {
      if (!this.results.length) {
        return;
      }

      const nextIndex = this.selectedIndex < 0
        ? 0
        : (this.selectedIndex + step + this.results.length) % this.results.length;

      this.activePane = "local";
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

    async openLocalSelected(disposition) {
      const selectedResult = this.results[this.selectedIndex];
      if (!selectedResult) {
        return;
      }

      await this.openResultTarget(selectedResult, disposition);
    }

    async openFocusedResult(disposition) {
      const result = this.getFocusedResult();
      if (!result) {
        return;
      }

      await this.openResultTarget(result, disposition);
    }

    async openResultTarget(result, disposition) {
      if (!result) {
        return;
      }

      if (result.type === "recent") {
        this.input.value = result.meta.query;
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
        result,
        disposition: effectiveDisposition
      });

      if (!response || response.ok === false) {
        this.summaryElement.textContent = response && response.error ? response.error : "Не удалось открыть результат";
        return;
      }

      if (this.settings.closeOnOpen) {
        this.close();
      }
    }

    async copyFocusedLink() {
      const result = this.getFocusedResult();
      if (!result || !result.url) {
        return;
      }

      const copied = await copyTextToClipboard(result.url, this.shadow);
      this.summaryElement.textContent = copied ? "Ссылка скопирована" : "Не удалось скопировать ссылку";
    }

    getFocusedResult() {
      if (this.activePane === "topic" && this.topicResults[this.topicSelectedIndex]) {
        return this.topicResults[this.topicSelectedIndex];
      }

      if (this.results[this.selectedIndex]) {
        return this.results[this.selectedIndex];
      }

      return this.topicResults[this.topicSelectedIndex] || null;
    }

    defaultDisposition() {
      return this.settings.enterBehavior === "new-tab" ? "newForeground" : "current";
    }

    updateModeBadge(mode) {
      if (this.modeBadgeElement) {
        this.modeBadgeElement.textContent = SOURCE_LABELS[sanitizeMode(mode)] || "Все";
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

    formatResultCount(count) {
      const lastDigit = count % 10;
      const lastTwoDigits = count % 100;
      let label = "результатов";

      if (lastDigit === 1 && lastTwoDigits !== 11) {
        label = "результат";
      } else if ([2, 3, 4].includes(lastDigit) && ![12, 13, 14].includes(lastTwoDigits)) {
        label = "результата";
      }

      return `${count} ${label}`;
    }
  }

  browserRun.content = {
    BrowserRunOverlay
  };
})();
