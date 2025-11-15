// path: background/service_worker.js
// Minimal event-driven worker: capture on demand, set badge/colors, store defaults.

const DEFAULTS = {
    tileSize: 10,
    stride: 2,
    pixelDiffThreshold: 20,
    tileChangeRatioThreshold: 0.2,
    warnPercent: 2,
    alertPercent: 10,
    overlayAutoHideMs: 6000
  };
  
  async function ensureDefaults() {
    const current = await chrome.storage.sync.get(null);
    const missing = {};
    for (const [k, v] of Object.entries(DEFAULTS)) {
      if (!(k in current)) missing[k] = v;
    }
    if (Object.keys(missing).length) {
      await chrome.storage.sync.set(missing);
    }
  }
  ensureDefaults().catch(() => { /* best effort */ });
  
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
      if (msg?.type === "CAPTURE") {
        // Why: capture via background avoids cross-origin and yields true pixels.
        const windowId = sender?.tab?.windowId;
        if (typeof windowId !== "number") {
          sendResponse({ ok: false, reason: "no-window" });
          return;
        }
        try {
          const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
          sendResponse({ ok: true, dataUrl });
        } catch (e) {
          // Race: try once after a short delay.
          try {
            await new Promise(r => setTimeout(r, 120));
            const dataUrl2 = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
            sendResponse({ ok: true, dataUrl: dataUrl2 });
          } catch (e2) {
            sendResponse({ ok: false, reason: "capture-failed" });
          }
        }
      } else if (msg?.type === "BADGE") {
        const { percent = 0 } = msg;
        const tabId = sender?.tab?.id;
        if (typeof tabId !== "number") return;
  
        const { warnPercent, alertPercent } = await chrome.storage.sync.get(["warnPercent", "alertPercent"]);
  
        const p = Math.max(0, Math.min(100, Math.round(percent)));
        let text = "";
        let color = [0, 0, 0, 0]; // transparent
        if (p >= alertPercent) {
          text = `${p}%`;
          color = [220, 53, 69, 255]; // red-ish
        } else if (p >= warnPercent) {
          text = `${p}%`;
          color = [255, 193, 7, 255]; // amber
        }
        await chrome.action.setBadgeText({ tabId, text });
        await chrome.action.setBadgeBackgroundColor({ tabId, color });
        await chrome.action.setTitle({
          tabId,
          title: text ? `Tab changed by ~${p}% since last focus` : "No significant change detected"
        });
      }
      // Keep message channel alive for async
    })();
    return true;
  });
  