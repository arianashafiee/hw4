// path: options/options.js
const fields = ["tileSize","stride","pixelDiffThreshold","tileChangeRatioThreshold","warnPercent","alertPercent","overlayAutoHideMs"];

async function load() {
  const vals = await chrome.storage.sync.get(fields);
  for (const k of fields) {
    const el = document.getElementById(k);
    el.value = (k in vals) ? vals[k] : el.value;
  }
}
async function save() {
  const obj = {};
  for (const k of fields) {
    const el = document.getElementById(k);
    const v = el.type === "number" ? Number(el.value) : el.value;
    obj[k] = v;
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
