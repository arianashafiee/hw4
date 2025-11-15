// path: options/options.js
const fields = [
    "tileSize","stride","pixelDiffThreshold","tileChangeRatioThreshold",
    "warnPercent","alertPercent","overlayAutoHideMs",
    "baselineIntervalMs","visibleCaptureDelayMs","secondPassDelayMs"
  ];
  
  async function load() {
    const vals = await chrome.storage.sync.get(fields);
    for (const k of fields) {
      const el = document.getElementById(k);
      if (!el) continue;
      el.value = (k in vals) ? vals[k] : (el.value || "");
    }
  }
  async function save() {
    const obj = {};
    for (const k of fields) {
      const el = document.getElementById(k);
      if (!el) continue;
      obj[k] = Number(el.value);
    }
    await chrome.storage.sync.set(obj);
    alert("Saved.");
  }
  async function reset() {
    await chrome.storage.sync.clear();
    alert("Reset. Defaults will take effect.");
    await load();
  }
  document.getElementById("save").addEventListener("click", () => { save().catch(console.error); });
  document.getElementById("reset").addEventListener("click", () => { reset().catch(console.error); });
  load().catch(console.error);
  