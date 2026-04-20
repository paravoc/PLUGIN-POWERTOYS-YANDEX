(() => {
  const browserRun = globalThis.BrowserRun || (globalThis.BrowserRun = {});

  async function copyTextToClipboard(text, root) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_error) {
      try {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.setAttribute("readonly", "true");
        textArea.className = "br-copy-buffer";
        root.appendChild(textArea);
        textArea.select();
        const copied = document.execCommand("copy");
        textArea.remove();
        return copied;
      } catch (_fallbackError) {
        return false;
      }
    }
  }

  browserRun.clipboard = {
    copyTextToClipboard
  };
})();
