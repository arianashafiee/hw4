// path: content/content.js
// Runs on every page. Orchestrates capture-before-blur, capture-on-return, diff, overlay.

(() => {
    let baseShot = null; // { dataUrl, w, h }
    let overlayId = null;
    let opts = {
      tileSize: 10,
      stride: 2,
      pixelDiffThreshold: 20,
      tileChangeRatioThreshold: 0.2,
      overlayAutoHideMs: 6000
    };
  
    // Load options initially and keep them fresh.
    chrome.storage.sync.get([
      "tileSize",
      "stride",
      "pixelDiffThreshold",
      "tileChangeRatioThreshold",
      "overlayAutoHideMs"
    ], (res) => {
      Object.assign(opts, res);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      for (const [k, v] of Object.entries(changes)) {
        if (k in opts) opts[k] = v.newValue;
      }
    });
  
    async function capture() {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "CAPTURE" }, (resp) => {
          if (!resp || !resp.ok) return resolve(null);
          const img = new Image();
          img.onload = () => resolve({ dataUrl: resp.dataUrl, w: img.naturalWidth, h: img.naturalHeight });
          img.src = resp.dataUrl;
        });
      });
    }
  
    function removeOverlay() {
      if (!overlayId) return;
      const el = document.getElementById(overlayId);
      if (el) el.remove();
      overlayId = null;
    }
  
    function drawOverlay(w, h, tiles, tileSize, autoHideMs) {
      removeOverlay();
      const id = `tabnab-overlay-${Math.random().toString(36).slice(2, 8)}`;
      overlayId = id;
      const root = document.createElement("div");
      root.id = id;
      root.className = "tabnab-overlay-root";
      root.style.position = "fixed";
      root.style.left = "0";
      root.style.top = "0";
      root.style.width = "100vw";
      root.style.height = "100vh";
      root.style.zIndex = "2147483647";
      root.style.pointerEvents = "none";
  
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const scaleX = vw / w;
      const scaleY = vh / h;
  
      for (const t of tiles) {
        const block = document.createElement("div");
        block.className = "tabnab-overlay-tile";
        block.style.position = "absolute";
        block.style.left = `${Math.floor(t.x * tileSize * scaleX)}px`;
        block.style.top = `${Math.floor(t.y * tileSize * scaleY)}px`;
        block.style.width = `${Math.ceil(tileSize * scaleX)}px`;
        block.style.height = `${Math.ceil(tileSize * scaleY)}px`;
        root.appendChild(block);
      }
      document.documentElement.appendChild(root);
      if (autoHideMs > 0) {
        setTimeout(removeOverlay, autoHideMs);
      }
    }
  
    function getImageData(img, w, h) {
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);
      return ctx.getImageData(0, 0, w, h);
    }
  
    function computeDiff(baseImg, currImg, options) {
      const tileSize = options.tileSize;
      const stride = options.stride;
      const pxThresh = options.pixelDiffThreshold;
      const tileRatioThresh = options.tileChangeRatioThreshold;
  
      const w = baseImg.width;
      const h = baseImg.height;
      const dataA = baseImg.data;
      const dataB = currImg.data;
  
      const tilesX = Math.ceil(w / tileSize);
      const tilesY = Math.ceil(h / tileSize);
  
      const changedTiles = [];
      let totalTiles = tilesX * tilesY;
  
      function pixelChanged(ax, ay) {
        const idx = (ay * w + ax) * 4;
        const dr = Math.abs(dataA[idx] - dataB[idx]);
        const dg = Math.abs(dataA[idx + 1] - dataB[idx + 1]);
        const db = Math.abs(dataA[idx + 2] - dataB[idx + 2]);
        const d = (dr + dg + db) / 3;
        return d >= pxThresh;
      }
  
      for (let ty = 0; ty < tilesY; ty++) {
        for (let tx = 0; tx < tilesX; tx++) {
          const x0 = tx * tileSize;
          const y0 = ty * tileSize;
          const x1 = Math.min(x0 + tileSize, w);
          const y1 = Math.min(y0 + tileSize, h);
  
          let diffCount = 0;
          let sampleCount = 0;
          // Early exit when clearly over threshold
          const maxSamples = Math.max(1, Math.floor(((x1 - x0) * (y1 - y0)) / (stride * stride)));
          const earlyStop = Math.ceil(maxSamples * tileRatioThresh);
  
          for (let y = y0; y < y1; y += stride) {
            for (let x = x0; x < x1; x += stride) {
              sampleCount++;
              if (pixelChanged(x, y)) {
                diffCount++;
                if (diffCount >= earlyStop) break;
              }
            }
            if (diffCount >= earlyStop) break;
          }
  
          const ratio = sampleCount ? (diffCount / sampleCount) : 0;
          if (ratio >= tileRatioThresh) {
            changedTiles.push({ x: tx, y: ty });
          }
        }
      }
  
      const percent = (changedTiles.length / totalTiles) * 100;
      return { changedTiles, totalTiles, percent };
    }
  
    async function onHidden() {
      // Why: take “last seen” snapshot for this tab.
      const shot = await capture();
      if (shot) baseShot = shot;
    }
  
    async function onVisible() {
      if (!baseShot) return; // nothing to compare
      const curr = await capture();
      if (!curr) return;
  
      // Normalize to base size
      const baseImg = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = baseShot.dataUrl; });
      const currImgRaw = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = curr.dataUrl; });
  
      const w = baseShot.w;
      const h = baseShot.h;
  
      // Draw current scaled to base WxH
      const tmpCanvas = document.createElement("canvas");
      tmpCanvas.width = w; tmpCanvas.height = h;
      const tmpCtx = tmpCanvas.getContext("2d");
      tmpCtx.drawImage(currImgRaw, 0, 0, w, h);
  
      const baseData = getImageData(baseImg, w, h);
      const currData = tmpCtx.getImageData(0, 0, w, h);
  
      const { changedTiles, percent } = computeDiff(baseData, currData, opts);
  
      // Overlay
      drawOverlay(w, h, changedTiles, opts.tileSize, opts.overlayAutoHideMs);
  
      // Badge
      chrome.runtime.sendMessage({ type: "BADGE", percent }).catch(() => { /* ignore */ });
  
      // Reset baseline to current after we’ve alerted.
      baseShot = curr;
    }
  
    // Hook visibility changes.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        onHidden().catch(() => {});
      } else if (document.visibilityState === "visible") {
        onVisible().catch(() => {});
      }
    }, { passive: true });
  
    // If the page starts visible, prime a baseline soon after load.
    if (document.visibilityState === "visible") {
      setTimeout(() => { onHidden().catch(() => {}); }, 500);
    }
  })();
  