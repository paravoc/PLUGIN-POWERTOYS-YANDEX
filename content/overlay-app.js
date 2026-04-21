(() => {
  const browserRun = globalThis.BrowserRun || (globalThis.BrowserRun = {});
  const { DEFAULT_SETTINGS, SOURCE_LABELS, TYPE_LABELS } = browserRun.constants;
  const {
    sanitizeMode,
    parseScopedQuery,
    normalize,
    matchesQuery,
    computeScore,
    shortenUrl,
    getSiteLabel,
    canonicalizeUrl,
    isSearchEngineUrl,
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
      this.pageTopicCount = 0;
      this.settings = { ...DEFAULT_SETTINGS };
      this.recentQueries = [];
      this.currentMode = this.settings.defaultSource;
      this.currentQuery = "";
      this.searchTimer = null;
      this.searchSequence = 0;
      this.cssTextPromise = null;
      this.lastActiveElement = null;
      this.focusTimeouts = [];

      this.handleBackdropMouseDown = this.handleBackdropMouseDown.bind(this);
      this.handleInputEvent = this.handleInputEvent.bind(this);
      this.handleInputKeyDown = this.handleInputKeyDown.bind(this);
      this.handleResultsClick = this.handleResultsClick.bind(this);
      this.handleResultsMouseMove = this.handleResultsMouseMove.bind(this);
      this.handleTopicListClick = this.handleTopicListClick.bind(this);
      this.handleDocumentKeyDown = this.handleDocumentKeyDown.bind(this);
      this.handleDocumentFocusIn = this.handleDocumentFocusIn.bind(this);
      this.handleDocumentPaste = this.handleDocumentPaste.bind(this);
    }

    async toggle() {
      if (this.isOpen) {
        this.close();
        return;
      }

      await this.open();
    }

    async open() {
      if (this.isOpen) {
        return;
      }

      this.isOpen = true;
      this.lastActiveElement = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

      try {
        const [settings, cssText] = await Promise.all([
          this.loadSettings(),
          this.loadCssText()
        ]);

        if (!this.isOpen) {
          return;
        }

        this.settings = settings;
        this.recentQueries = this.settings.rememberQueries ? await this.getRecentQueries() : [];
        this.currentMode = sanitizeMode(this.settings.defaultSource);
        this.currentQuery = "";

        this.mount(cssText);
        this.renderEmptyState();
        this.focusInputSoon(true);
      } catch (error) {
        this.isOpen = false;
        this.lastActiveElement = null;
        throw error;
      }
    }

    close() {
      if (!this.isOpen) {
        return;
      }

      this.isOpen = false;
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
      this.searchSequence += 1;
      this.clearFocusTimers();

      document.removeEventListener("keydown", this.handleDocumentKeyDown, true);
      document.removeEventListener("focusin", this.handleDocumentFocusIn, true);
      document.removeEventListener("paste", this.handleDocumentPaste, true);

      if (this.host) {
        this.host.remove();
      }

      if (this.lastActiveElement && this.lastActiveElement.isConnected) {
        try {
          this.lastActiveElement.focus({ preventScroll: true });
        } catch (_error) {
          // Ignore focus restoration errors.
        }
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
      this.pageTopicCount = 0;
      this.lastActiveElement = null;
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
      document.addEventListener("focusin", this.handleDocumentFocusIn, true);
      document.addEventListener("paste", this.handleDocumentPaste, true);

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
                  <div class="br-subtitle">Слева локальный поиск, справа сайты по теме</div>
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
                    <div class="br-topic-title">Сайты по теме</div>
                    <div class="br-topic-subtitle" data-role="topic-summary">До 10 сайтов</div>
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
                <span>Enter открыть</span>
                <span>Ctrl+Enter новая вкладка</span>
                <span>Печать всегда идёт в поле поиска</span>
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
          this.pageTopicCount = 0;
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

        const localResults = Array.isArray(response.results) ? response.results : [];
        const fallbackTopicResults = Array.isArray(response.topicResults) ? response.topicResults.slice(0, 10) : [];
        const pageTopicResults = this.collectPageTopicResults(this.currentQuery);

        this.results = localResults;
        this.pageTopicCount = pageTopicResults.length;
        this.topicResults = this.mergeTopicResults(pageTopicResults, fallbackTopicResults);
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
        this.pageTopicCount = 0;
        this.selectedIndex = -1;
        this.topicSelectedIndex = -1;
        this.renderError(error instanceof Error ? error.message : "Не удалось выполнить поиск.");
      }
    }

    renderEmptyState() {
      this.loadingElement.hidden = true;
      this.pageTopicCount = 0;
      this.activePane = "local";

      const pageTopicResults = this.collectPageTopicResults("");
      this.topicResults = pageTopicResults.slice(0, 10);
      this.topicSelectedIndex = this.topicResults.length > 0 ? 0 : -1;
      this.pageTopicCount = this.topicResults.length;

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
          <div class="br-state-copy">Слева появятся локальные результаты из вкладок, закладок и истории. Если вы на странице поисковой выдачи, справа появятся сайты с этой выдачи.</div>
        </div>
      `;
      this.previewElement.innerHTML = `
        <div class="br-preview-empty">
          <div class="br-preview-title">Локальный поиск</div>
          <div class="br-preview-copy">Введите тему, например «коты». Печать и вставка будут попадать в поле плагина даже на Google и Yandex.</div>
        </div>
      `;
      this.renderTopicResults();
      this.summaryElement.textContent = this.topicResults.length > 0
        ? "Справа показаны сайты с текущей поисковой страницы"
        : "Начните ввод, чтобы искать по браузеру";
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
      this.summaryElement.textContent = `Слева: ${this.formatResultCount(this.results.length)}. Справа: ${this.describeTopicSummary()}.`;
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
            <div class="br-preview-copy">Выберите элемент слева или сайт по теме справа.</div>
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

      this.topicSummaryElement.textContent = this.describeTopicSummary();

      if (!this.topicResults.length) {
        const emptyText = this.getCurrentSearchPageDescriptor()
          ? "На текущей поисковой странице не нашлось подходящих сайтов по этому запросу."
          : "Откройте поисковую выдачу или введите другой запрос, чтобы найти сайты по теме.";

        this.topicListElement.innerHTML = `
          <div class="br-topic-empty">${escapeHtml(emptyText)}</div>
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
      this.focusInputSoon(false);
    }

    handleDocumentKeyDown(event) {
      if (!this.isOpen) {
        return;
      }

      const isSearchInputTarget = this.isEventTargetSearchInput(event);

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.close();
        return;
      }

      if (event.key === "ArrowDown" && !isSearchInputTarget) {
        event.preventDefault();
        event.stopPropagation();
        this.moveSelection(1);
        this.focusInputSoon(false);
        return;
      }

      if (event.key === "ArrowUp" && !isSearchInputTarget) {
        event.preventDefault();
        event.stopPropagation();
        this.moveSelection(-1);
        this.focusInputSoon(false);
        return;
      }

      if (event.key === "Enter" && !isSearchInputTarget) {
        event.preventDefault();
        event.stopPropagation();

        let disposition = this.defaultDisposition();
        if (event.ctrlKey || event.metaKey) {
          disposition = "newForeground";
        } else if (event.shiftKey) {
          disposition = "newBackground";
        }

        this.openLocalSelected(disposition);
        return;
      }

      if (event.key === "Tab" && !isSearchInputTarget) {
        event.preventDefault();
        event.stopPropagation();
        this.focusInputSoon(false);
        return;
      }

      if (!isSearchInputTarget && this.captureInputKey(event)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    handleDocumentFocusIn(event) {
      if (!this.isOpen) {
        return;
      }

      if (this.isEventInsideOverlay(event)) {
        return;
      }

      this.focusInputSoon(false);
    }

    handleDocumentPaste(event) {
      if (!this.isOpen || this.isEventTargetSearchInput(event)) {
        return;
      }

      const text = event.clipboardData?.getData("text");
      if (!text) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      this.insertTextAtCursor(text);
      this.dispatchInputEvent();
      this.focusInputSoon(false);
    }

    async handleInputKeyDown(event) {
      if (!this.isOpen) {
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        this.moveSelection(1);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        this.moveSelection(-1);
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();

        let disposition = this.defaultDisposition();
        if (event.ctrlKey || event.metaKey) {
          disposition = "newForeground";
        } else if (event.shiftKey) {
          disposition = "newBackground";
        }

        await this.openLocalSelected(disposition);
      }
    }

    captureInputKey(event) {
      if (!this.input || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) {
        return false;
      }

      if (event.key === "Backspace") {
        this.removeTextBeforeCursor();
        this.dispatchInputEvent();
        this.focusInputSoon(false);
        return true;
      }

      if (event.key === "Delete") {
        this.removeTextAfterCursor();
        this.dispatchInputEvent();
        this.focusInputSoon(false);
        return true;
      }

      if (event.key === " " || event.key.length === 1) {
        this.insertTextAtCursor(event.key);
        this.dispatchInputEvent();
        this.focusInputSoon(false);
        return true;
      }

      return false;
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
      const selectedResult = this.results[this.selectedIndex] || this.getFocusedResult();
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
        this.dispatchInputEvent();
        this.focusInputSoon(true);
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

    clearFocusTimers() {
      while (this.focusTimeouts.length > 0) {
        clearTimeout(this.focusTimeouts.pop());
      }
    }

    focusInputSoon(selectAll) {
      if (!this.input) {
        return;
      }

      this.focusInput(selectAll);
      this.clearFocusTimers();

      for (const delay of [0, 40, 120]) {
        const timeoutId = window.setTimeout(() => {
          this.focusInput(selectAll);
        }, delay);
        this.focusTimeouts.push(timeoutId);
      }
    }

    focusInput(selectAll) {
      if (!this.input || !this.isOpen) {
        return;
      }

      try {
        this.input.focus({ preventScroll: true });
      } catch (_error) {
        this.input.focus();
      }

      if (selectAll) {
        this.input.select();
      }
    }

    dispatchInputEvent() {
      if (!this.input) {
        return;
      }

      this.input.dispatchEvent(new Event("input", {
        bubbles: true,
        composed: true
      }));
    }

    insertTextAtCursor(text) {
      if (!this.input) {
        return;
      }

      const selectionStart = this.input.selectionStart ?? this.input.value.length;
      const selectionEnd = this.input.selectionEnd ?? selectionStart;
      const nextValue = `${this.input.value.slice(0, selectionStart)}${text}${this.input.value.slice(selectionEnd)}`;
      const nextCursor = selectionStart + text.length;

      this.input.value = nextValue;
      this.input.setSelectionRange(nextCursor, nextCursor);
    }

    removeTextBeforeCursor() {
      if (!this.input) {
        return;
      }

      const selectionStart = this.input.selectionStart ?? this.input.value.length;
      const selectionEnd = this.input.selectionEnd ?? selectionStart;

      if (selectionStart !== selectionEnd) {
        this.input.value = `${this.input.value.slice(0, selectionStart)}${this.input.value.slice(selectionEnd)}`;
        this.input.setSelectionRange(selectionStart, selectionStart);
        return;
      }

      if (selectionStart <= 0) {
        return;
      }

      this.input.value = `${this.input.value.slice(0, selectionStart - 1)}${this.input.value.slice(selectionStart)}`;
      this.input.setSelectionRange(selectionStart - 1, selectionStart - 1);
    }

    removeTextAfterCursor() {
      if (!this.input) {
        return;
      }

      const selectionStart = this.input.selectionStart ?? this.input.value.length;
      const selectionEnd = this.input.selectionEnd ?? selectionStart;

      if (selectionStart !== selectionEnd) {
        this.input.value = `${this.input.value.slice(0, selectionStart)}${this.input.value.slice(selectionEnd)}`;
        this.input.setSelectionRange(selectionStart, selectionStart);
        return;
      }

      if (selectionStart >= this.input.value.length) {
        return;
      }

      this.input.value = `${this.input.value.slice(0, selectionStart)}${this.input.value.slice(selectionStart + 1)}`;
      this.input.setSelectionRange(selectionStart, selectionStart);
    }

    isEventInsideOverlay(event) {
      const path = typeof event.composedPath === "function" ? event.composedPath() : [];
      return path.includes(this.host) || path.includes(this.shadow);
    }

    isEventTargetSearchInput(event) {
      const path = typeof event.composedPath === "function" ? event.composedPath() : [];
      return path.includes(this.input);
    }

    getCurrentSearchPageDescriptor() {
      try {
        const url = new URL(window.location.href);
        const host = url.hostname.toLowerCase();
        const path = url.pathname.toLowerCase();

        if (host.includes("google.") && url.searchParams.has("q")) {
          return {
            provider: "google",
            query: url.searchParams.get("q") || "",
            rootSelector: "#search, main, [role='main']"
          };
        }

        if ((host === "yandex.ru" || host.endsWith(".yandex.ru") || host === "ya.ru")
          && (path.startsWith("/search") || url.searchParams.has("text"))) {
          return {
            provider: "yandex",
            query: url.searchParams.get("text") || url.searchParams.get("query") || "",
            rootSelector: "#search-result, main, [role='main'], .serp-list"
          };
        }

        if (host.includes("bing.com") && url.searchParams.has("q")) {
          return {
            provider: "bing",
            query: url.searchParams.get("q") || "",
            rootSelector: "#b_results, main, [role='main']"
          };
        }

        if (host.includes("duckduckgo.com") && url.searchParams.has("q")) {
          return {
            provider: "duckduckgo",
            query: url.searchParams.get("q") || "",
            rootSelector: "#links, main, [role='main']"
          };
        }

        if (host.includes("search.yahoo.com") && url.searchParams.has("p")) {
          return {
            provider: "yahoo",
            query: url.searchParams.get("p") || "",
            rootSelector: "#web, main, [role='main']"
          };
        }

        return null;
      } catch (_error) {
        return null;
      }
    }

    collectPageTopicResults(query) {
      const descriptor = this.getCurrentSearchPageDescriptor();
      if (!descriptor) {
        return [];
      }

      const effectiveQuery = normalize(query || descriptor.query);
      const root = this.findSearchResultsRoot(descriptor.rootSelector);
      const anchors = [...root.querySelectorAll("a[href]")];
      const results = [];
      const seenUrls = new Set();

      for (const anchor of anchors) {
        if (!(anchor instanceof HTMLAnchorElement)) {
          continue;
        }

        if (!this.isLikelySearchResultAnchor(anchor)) {
          continue;
        }

        const targetUrl = this.resolveSearchResultUrl(anchor.href);
        if (!targetUrl || isSearchEngineUrl(targetUrl)) {
          continue;
        }

        const urlKey = canonicalizeUrl(targetUrl);
        if (seenUrls.has(urlKey)) {
          continue;
        }

        const title = this.extractSearchResultTitle(anchor);
        if (!title || title.length < 3) {
          continue;
        }

        const snippet = this.extractSearchResultSnippet(anchor, title);
        const site = getSiteLabel(targetUrl);

        if (effectiveQuery && !matchesQuery(effectiveQuery, `${title} ${snippet} ${site}`, targetUrl)) {
          continue;
        }

        seenUrls.add(urlKey);
        results.push({
          id: `page-topic:${urlKey}`,
          type: "topic",
          title,
          url: targetUrl,
          snippet,
          icon: null,
          score: computeScore(effectiveQuery, `${title} ${snippet}`, `${site} ${targetUrl}`) + Math.max(0, 120 - results.length * 10),
          meta: {
            site,
            sourceType: "page-search",
            sourceLabel: "Текущая выдача"
          }
        });

        if (results.length >= 10) {
          break;
        }
      }

      return results;
    }

    findSearchResultsRoot(rootSelector) {
      if (!rootSelector) {
        return document.body;
      }

      const selectors = rootSelector.split(",").map((item) => item.trim()).filter(Boolean);
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
          return element;
        }
      }

      return document.body;
    }

    isLikelySearchResultAnchor(anchor) {
      if (!anchor.href || anchor.offsetParent === null) {
        return false;
      }

      if (anchor.closest("header, nav, footer, aside, [role='navigation'], [aria-label*='navigation'], [aria-label*='Навига']")) {
        return false;
      }

      const normalizedHref = this.resolveSearchResultUrl(anchor.href);
      if (!normalizedHref || !/^https?:\/\//i.test(normalizedHref)) {
        return false;
      }

      const title = this.extractSearchResultTitle(anchor);
      if (title && title.length >= 8) {
        return true;
      }

      const text = this.compactText(anchor.textContent);
      return text.length >= 18 && text.length <= 180;
    }

    resolveSearchResultUrl(rawHref) {
      try {
        const parsed = new URL(rawHref, window.location.href);

        for (const paramName of ["q", "url", "u", "uddg", "target", "to"]) {
          const rawTarget = parsed.searchParams.get(paramName);
          if (!rawTarget) {
            continue;
          }

          const decodedTarget = decodeURIComponent(rawTarget);
          if (/^https?:\/\//i.test(decodedTarget)) {
            return decodedTarget;
          }
        }

        if (!["http:", "https:"].includes(parsed.protocol)) {
          return "";
        }

        if (parsed.hostname.toLowerCase() === window.location.hostname.toLowerCase()) {
          return "";
        }

        return parsed.toString();
      } catch (_error) {
        return "";
      }
    }

    extractSearchResultTitle(anchor) {
      const titleCandidate = anchor.querySelector("h1, h2, h3, h4, h5, h6");
      const candidates = [
        titleCandidate ? titleCandidate.textContent : "",
        anchor.getAttribute("aria-label"),
        anchor.textContent,
        anchor.title
      ];

      for (const candidate of candidates) {
        const text = this.compactText(candidate);
        if (text.length >= 3 && text.length <= 220) {
          return text;
        }
      }

      return "";
    }

    extractSearchResultSnippet(anchor, title) {
      const container = anchor.closest("article, li, .serp-item, .organic, .result, .b_algo, .links_main");
      const rawText = this.compactText(
        container?.innerText
        || container?.textContent
        || anchor.parentElement?.innerText
        || anchor.parentElement?.textContent
        || ""
      );

      if (!rawText) {
        return "";
      }

      let snippet = rawText;
      if (title) {
        snippet = snippet.replace(title, "").trim();
      }

      return snippet.length > 220 ? `${snippet.slice(0, 217)}...` : snippet;
    }

    mergeTopicResults(primaryResults, fallbackResults) {
      const merged = [];
      const seenUrls = new Set();

      for (const result of [...primaryResults, ...fallbackResults]) {
        if (!result || !result.url) {
          continue;
        }

        const urlKey = canonicalizeUrl(result.url);
        if (seenUrls.has(urlKey)) {
          continue;
        }

        seenUrls.add(urlKey);
        merged.push(result);

        if (merged.length >= 10) {
          break;
        }
      }

      return merged;
    }

    compactText(value) {
      return String(value || "").replace(/\s+/g, " ").trim();
    }

    describeTopicSummary() {
      if (!this.topicResults.length) {
        return this.getCurrentSearchPageDescriptor()
          ? "0 сайтов из текущей выдачи"
          : "0 сайтов";
      }

      if (this.pageTopicCount > 0 && this.topicResults.length > this.pageTopicCount) {
        return `${this.topicResults.length} сайтов: выдача + браузер`;
      }

      if (this.pageTopicCount > 0) {
        return `${this.topicResults.length} сайтов из текущей выдачи`;
      }

      return `${this.topicResults.length} сайтов из браузера`;
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
