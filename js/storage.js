/* Persistência local das 4 planilhas de forecast (por ano) + dataset ativo */
const Storage = (() => {
  const DB_NAME = 'tsoc-bfr-custos';
  const DB_VERSION = 2;
  const STORE = 'forecasts';
  const ACTIVE_KEY = 'tsoc-bfr-active-v1';
  const YEAR_PREF_KEY = 'tsoc-bfr-selected-year';
  const FORECASTS = ['budget', 'fc1', 'fc2', 'fc3'];

  function slotKey(forecast, year) {
    return `${forecast}_${Number(year)}`;
  }

  function parseSlotKey(key) {
    const m = String(key || '').match(/^(budget|fc1|fc2|fc3)_(\d{4})$/);
    if (m) return { forecast: m[1], year: Number(m[2]) };
    if (FORECASTS.includes(String(key))) return { forecast: String(key), year: null, legacy: true };
    return null;
  }

  function isForecastSlot(slot) {
    return Boolean(parseSlotKey(slot));
  }

  function getPreferredYear(fallback = 2026) {
    try {
      const y = Number(localStorage.getItem(YEAR_PREF_KEY));
      if (y >= 2000 && y <= 2100) return y;
    } catch (_) { /* ignore */ }
    return Number(fallback) || 2026;
  }

  function setPreferredYear(year) {
    try {
      localStorage.setItem(YEAR_PREF_KEY, String(year));
    } catch (_) { /* ignore */ }
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'slot' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function withStore(mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      Promise.resolve(fn(store))
        .then((result) => {
          tx.oncomplete = () => resolve(result);
          tx.onerror = () => reject(tx.error);
        })
        .catch(reject);
    });
  }

  async function saveSlot(slot, payload) {
    const record = {
      slot,
      fileName: payload.fileName,
      uploadedAt: payload.uploadedAt || new Date().toISOString(),
      rowCount: payload.rows?.length || 0,
      rows: payload.rows,
      meta: payload.meta || {},
      fileBlob: payload.fileBlob || null,
      mimeType: payload.mimeType || 'application/octet-stream'
    };
    try {
      await withStore('readwrite', (store) => {
        store.put(record);
      });
    } catch (err) {
      // Blob grande pode estourar cota — grava só os dados (o que importa para o histórico)
      if (record.fileBlob) {
        record.fileBlob = null;
        await withStore('readwrite', (store) => {
          store.put(record);
        });
        return;
      }
      throw err;
    }
  }

  async function getSlot(slot) {
    return withStore('readonly', (store) => new Promise((resolve, reject) => {
      const req = store.get(slot);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    }));
  }

  async function listSlots() {
    return withStore('readonly', (store) => new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    }));
  }

  async function clearSlot(slot) {
    await withStore('readwrite', (store) => {
      store.delete(slot);
    });
  }

  async function clearAll({ keepKsb1 = false } = {}) {
    if (!keepKsb1) {
      await withStore('readwrite', (store) => {
        store.clear();
      });
      return;
    }
    const all = await listSlots();
    await withStore('readwrite', (store) => {
      all.forEach((s) => {
        const key = String(s?.slot || '');
        if (key === 'ksb1' || key === 'ksb1_index' || key.startsWith('ksb1_')) return;
        store.delete(key);
      });
    });
  }

  function saveActiveDataset(dataset) {
    return saveSlot('_active', {
      fileName: dataset.meta?.source || 'dataset',
      uploadedAt: new Date().toISOString(),
      rows: dataset.rows,
      meta: dataset.meta
    });
  }

  async function loadActiveDataset() {
    const active = await getSlot('_active');
    if (!active?.rows?.length) return null;
    return { meta: active.meta || {}, rows: active.rows };
  }

  function cacheMeta(meta) {
    try {
      localStorage.setItem(ACTIVE_KEY, JSON.stringify({
        source: meta?.source,
        updatedAt: new Date().toISOString(),
        rowCount: meta?.rowCount
      }));
    } catch (_) { /* ignore */ }
  }

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function saveHistory(snapshot) {
    const id = `history_${snapshot.year}_${snapshot.mes}_${Date.now()}`;
    await saveSlot(id, {
      fileName: snapshot.label,
      uploadedAt: snapshot.savedAt || new Date().toISOString(),
      rows: snapshot.rows,
      meta: {
        kind: 'history',
        year: snapshot.year,
        mes: snapshot.mes,
        label: snapshot.label,
        scenario: snapshot.scenario || 'fc3'
      }
    });
    return id;
  }

  async function listHistories() {
    const all = await listSlots();
    return all
      .filter((s) => s.slot?.startsWith('history_') || s.meta?.kind === 'history')
      .sort((a, b) => String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')));
  }

  async function loadHistory(slot) {
    return getSlot(slot);
  }

  /** Migra slots antigos (budget) → budget_2026 (idempotente). */
  async function migrateLegacySlots(defaultYear = 2026) {
    const year = Number(defaultYear) || 2026;
    for (const forecast of FORECASTS) {
      const legacy = await getSlot(forecast);
      if (!legacy?.rows?.length) continue;
      const modern = slotKey(forecast, year);
      const existing = await getSlot(modern);
      if (!existing?.rows?.length) {
        await saveSlot(modern, {
          fileName: legacy.fileName,
          uploadedAt: legacy.uploadedAt,
          rows: legacy.rows,
          meta: { ...(legacy.meta || {}), slot: forecast, year, migratedFrom: forecast },
          fileBlob: legacy.fileBlob || null,
          mimeType: legacy.mimeType || 'application/octet-stream'
        });
      }
      await clearSlot(forecast);
    }
  }

  function listAvailableYears(slotList, seedYear = 2026) {
    const years = new Set([Number(seedYear) || 2026]);
    (slotList || []).forEach((s) => {
      const parsed = parseSlotKey(s.slot);
      if (!parsed) return;
      if (parsed.year) years.add(parsed.year);
      else if (parsed.legacy) years.add(Number(seedYear) || 2026);
    });
    return [...years].sort((a, b) => b - a);
  }

  function slotsForYear(slotList, year) {
    const yearNum = Number(year);
    const byKey = Object.fromEntries((slotList || []).map((s) => [s.slot, s]));
    const map = {};
    FORECASTS.forEach((forecast) => {
      const modern = byKey[slotKey(forecast, yearNum)];
      const legacy = yearNum === 2026 ? byKey[forecast] : null;
      if (modern?.rows?.length) map[forecast] = modern;
      else if (legacy?.rows?.length) map[forecast] = legacy;
    });
    return map;
  }

  function versionsByForecast(slotList, seedYear = 2026) {
    const result = Object.fromEntries(FORECASTS.map((f) => [f, []]));
    (slotList || []).forEach((s) => {
      const parsed = parseSlotKey(s.slot);
      if (!parsed || !s.rows?.length) return;
      const year = parsed.year || Number(seedYear) || 2026;
      result[parsed.forecast].push({
        ...s,
        forecast: parsed.forecast,
        year,
        slotKey: parsed.legacy ? slotKey(parsed.forecast, year) : s.slot
      });
    });
    FORECASTS.forEach((f) => {
      result[f].sort((a, b) => b.year - a.year);
    });
    return result;
  }

  return {
    FORECASTS,
    slotKey,
    parseSlotKey,
    isForecastSlot,
    getPreferredYear,
    setPreferredYear,
    saveSlot,
    getSlot,
    listSlots,
    clearSlot,
    clearAll,
    saveActiveDataset,
    loadActiveDataset,
    cacheMeta,
    downloadBlob,
    saveHistory,
    listHistories,
    loadHistory,
    migrateLegacySlots,
    listAvailableYears,
    slotsForYear,
    versionsByForecast
  };
})();
