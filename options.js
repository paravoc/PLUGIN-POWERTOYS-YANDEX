const { DEFAULT_SETTINGS } = globalThis.BrowserRun.constants;

const form = document.getElementById("settingsForm");
const statusMessage = document.getElementById("statusMessage");
const shortcutDisplay = document.getElementById("shortcutDisplay");
const openShortcutSettingsButton = document.getElementById("openShortcutSettings");
const resetButton = document.getElementById("resetButton");

const fields = {
  defaultSource: document.getElementById("defaultSource"),
  enableTabsSearch: document.getElementById("enableTabsSearch"),
  enableBookmarksSearch: document.getElementById("enableBookmarksSearch"),
  enableHistorySearch: document.getElementById("enableHistorySearch"),
  enableWebSearch: document.getElementById("enableWebSearch"),
  enterBehavior: document.getElementById("enterBehavior"),
  rememberQueries: document.getElementById("rememberQueries"),
  closeOnOpen: document.getElementById("closeOnOpen"),
  theme: document.getElementById("theme"),
  webSearchUrl: document.getElementById("webSearchUrl")
};

document.addEventListener("DOMContentLoaded", async () => {
  await loadSettingsIntoForm();
  await renderShortcut();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const settings = {
    ...DEFAULT_SETTINGS,
    defaultSource: fields.defaultSource.value,
    enableTabsSearch: fields.enableTabsSearch.checked,
    enableBookmarksSearch: fields.enableBookmarksSearch.checked,
    enableHistorySearch: fields.enableHistorySearch.checked,
    enableWebSearch: fields.enableWebSearch.checked,
    enterBehavior: fields.enterBehavior.value,
    rememberQueries: fields.rememberQueries.checked,
    closeOnOpen: fields.closeOnOpen.checked,
    theme: fields.theme.value,
    webSearchUrl: normalizeWebTemplate(fields.webSearchUrl.value)
  };

  await chrome.storage.local.set({ settings });
  showStatus("Настройки сохранены.");
});

resetButton.addEventListener("click", async () => {
  await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  await loadSettingsIntoForm();
  showStatus("Настройки сброшены.");
});

openShortcutSettingsButton.addEventListener("click", async () => {
  try {
    await chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
  } catch (_error) {
    showStatus("Откройте chrome://extensions/shortcuts вручную в адресной строке.");
  }
});

async function loadSettingsIntoForm() {
  const { settings } = await chrome.storage.local.get({
    settings: DEFAULT_SETTINGS
  });

  const merged = {
    ...DEFAULT_SETTINGS,
    ...(settings || {})
  };

  fields.defaultSource.value = merged.defaultSource;
  fields.enableTabsSearch.checked = Boolean(merged.enableTabsSearch);
  fields.enableBookmarksSearch.checked = Boolean(merged.enableBookmarksSearch);
  fields.enableHistorySearch.checked = Boolean(merged.enableHistorySearch);
  fields.enableWebSearch.checked = Boolean(merged.enableWebSearch);
  fields.enterBehavior.value = merged.enterBehavior;
  fields.rememberQueries.checked = Boolean(merged.rememberQueries);
  fields.closeOnOpen.checked = Boolean(merged.closeOnOpen);
  fields.theme.value = merged.theme;
  fields.webSearchUrl.value = merged.webSearchUrl;
}

async function renderShortcut() {
  try {
    const commands = await chrome.commands.getAll();
    const toggleCommand = commands.find((command) => command.name === "toggle-overlay");

    if (toggleCommand && toggleCommand.shortcut) {
      shortcutDisplay.textContent = toggleCommand.shortcut;
    } else {
      shortcutDisplay.textContent = "Не назначено";
    }
  } catch (_error) {
    shortcutDisplay.textContent = "Недоступно";
  }
}

function normalizeWebTemplate(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return DEFAULT_SETTINGS.webSearchUrl;
  }

  return trimmed.includes("%s") ? trimmed : `${trimmed}${trimmed.includes("?") ? "&" : "?"}q=%s`;
}

let statusTimer = null;

function showStatus(message) {
  statusMessage.textContent = message;
  clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => {
    statusMessage.textContent = "";
  }, 2400);
}
