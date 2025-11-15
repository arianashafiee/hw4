// path: content/content.js
(() => {
    // Test probe so E2E can confirm injection.
    document.documentElement.setAttribute('data-tabnab-installed', '1');
  
    let baseShot = null;                // { dataUrl, w, h, img? }
    let overlayId = null;
    let heartbeat = null;
    const qs = typeof location !== 'undefined' ? location.search : '';
    const testMode = /\be2e=1\b/.test(qs) || (typeof localStorage !== 'undefined' && localStorage.getItem('TABNAB_E2E') === '1');
  
    let opts = {
      tileSize: 10,
      stride: 2,
      pixelDiffThreshold: 20,
      tileChangeRatioThreshold: 0.2,
      overlayAutoHideMs: 6000,
      baselineIntervalMs: 1000,
      visibleCaptureDelayMs: 500,
      secondPassDelayMs: 800
    };
  
    chrome.storage.sync.get(Object.keys(opts), (res) => {
      Object.assign(opts, res || {});
      if (testMode) {
        // Make detections stable/visible in E2E runs.
        opts.overlayAutoHideMs = 0;
        opts.visibleCaptureDelayMs = Math.max(opts.visibleCaptureDelayMs, 1000);
        opts.secondPassDelayMs = Math.max(opts.secondPassDelayMs, 1000);
      }
    });
  
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      for (const [k, v] of Object.entries(changes)) if (k in opts) opts[k] = v.newValue;
    });
  
    const log = (...a) => { if (testMode) console.log('[tabnab]', ...a); };
  
    function msgBadge(percent) {
      try { chrome.runtime.sendMessage({ type: "BADGE", percent }); } catch {}
    }
  
    async function capture() {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "CAPTURE" }, (resp) => {
          if (!resp || !resp.ok || !resp.dataUrl) return resolve(null);
          const img = new Image();
          img.onload = () => resolve({ dataUrl: resp.dataUrl, w: img.naturalWidth, h: img.naturalHeight, img });
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
      if (!tiles.length) return;
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
      if (autoHideMs > 0) setTimeout(removeOverlay, autoHideMs);
    }
  
    function getImageData(img, w, h) {
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);
      return ctx.getImageData(0, 0, w, h);
    }
  
    function computeDiff(baseImg, currImg, options) {
      const { tileSize, stride, pixelDiffThreshold: pxThresh, tileChangeRatioThreshold: tileRatioThresh } = options;
      const w = baseImg.width, h = baseImg.height;
      const dataA = baseImg.data, dataB = currImg.data;
      const tilesX = Math.ceil(w / tileSize), tilesY = Math.ceil(h / tileSize);
      const changedTiles = [];
  
      function pxChanged(ax, ay) {
        const i = (ay * w + ax) * 4;
        const dr = Math.abs(dataA[i] - dataB[i]);
        const dg = Math.abs(dataA[i + 1] - dataB[i + 1]);
        const db = Math.abs(dataA[i + 2] - dataB[i + 2]);
        return ((dr + dg + db) / 3) >= pxThresh;
      }
  
      for (let ty = 0; ty < tilesY; ty++) {
        for (let tx = 0; tx < tilesX; tx++) {
          const x0 = tx * tileSize, y0 = ty * tileSize;
          const x1 = Math.min(x0 + tileSize, w), y1 = Math.min(y0 + tileSize, h);
          let diffCount = 0, sampleCount = 0;
          const area = (x1 - x0) * (y1 - y0);
          const maxSamples = Math.max(1, Math.floor(area / (stride * stride)));
          const earlyStop = Math.ceil(maxSamples * tileRatioThresh);
  
          for (let y = y0; y < y1; y += stride) {
            for (let x = x0; x < x1; x += stride) {
              sampleCount++;
              if (pxChanged(x, y)) {
                diffCount++;
                if (diffCount >= earlyStop) break;
              }
            }
            if (diffCount >= earlyStop) break;
          }
          if (sampleCount && (diffCount / sampleCount) >= tileRatioThresh) {
            changedTiles.push({ x: tx, y: ty });
          }
        }
      }
      const totalTiles = tilesX * tilesY;
      const percent = (changedTiles.length / totalTiles) * 100;
      return { changedTiles, percent };
    }
  
    async function doDiffOnce(label = "pass1") {
      if (!baseShot) return { percent: 0, changedTiles: [] };
      const curr = await capture();
      if (!curr) return { percent: 0, changedTiles: [] };
  
      const w = baseShot.w, h = baseShot.h;
      const baseImg = await new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = baseShot.dataUrl; });
      const tmpCanvas = document.createElement("canvas");
      tmpCanvas.width = w; tmpCanvas.height = h;
      const tmpCtx = tmpCanvas.getContext("2d");
      tmpCtx.drawImage(curr.img, 0, 0, w, h);
  
      const baseData = getImageData(baseImg, w, h);
      const currData = tmpCtx.getImageData(0, 0, w, h);
  
      const { changedTiles, percent } = computeDiff(baseData, currData, opts);
      log(`${label}: ${percent.toFixed(1)}% (${changedTiles.length} tiles)`);
      return { percent, changedTiles, curr };
    }
  
    function startHeartbeat() {
      if (heartbeat) return;
      log("heartbeat start");
      capture().then(shot => { if (shot) baseShot = shot; });
      heartbeat = setInterval(async () => {
        const shot = await capture();
        if (shot) baseShot = shot;
      }, Math.max(400, opts.baselineIntervalMs));
    }
  
    function stopHeartbeat() {
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
        log("heartbeat stop");
      }
    }
  
    async function onVisible() {
      await new Promise(r => setTimeout(r, Math.max(0, opts.visibleCaptureDelayMs)));
  
      let { percent, changedTiles, curr } = await doDiffOnce("pass1");
  
      const { warnPercent } = await new Promise(res => chrome.storage.sync.get(["warnPercent"], res));
      if (percent < (warnPercent ?? 2)) {
        await new Promise(r => setTimeout(r, Math.max(0, opts.secondPassDelayMs)));
        const p2 = await doDiffOnce("pass2");
        if (p2.percent > percent) ({ percent, changedTiles, curr } = p2);
      }
  
      drawOverlay(baseShot.w, baseShot.h, changedTiles, opts.tileSize, opts.overlayAutoHideMs);
      msgBadge(percent);
  
      // Signal for E2E: mark & emit event with percent.
      document.documentElement.setAttribute('data-tabnab-detected', '1');
      try { window.dispatchEvent(new CustomEvent('tabnab:detection', { detail: { percent } })); } catch {}
  
      if (curr) baseShot = curr;
      startHeartbeat();
    }
  
    function onHidden() { stopHeartbeat(); }
  
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") onHidden();
      else if (document.visibilityState === "visible") onVisible();
    }, { passive: true });
  
    if (document.visibilityState === "visible") startHeartbeat();
    else stopHeartbeat();
  })();
  