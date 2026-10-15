/* Pacote compartilhado via GitHub (data/shared-pack.json) */
const SharedPack = (() => {
  const PACK_URL = 'data/shared-pack.json';
  const APPLIED_KEY = 'tsoc-bfr-shared-applied-at';
  const VERSION = 1;

  function downloadJson(obj, fileName) {
    const blob = new Blob([JSON.stringify(obj)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function buildFromStorage({ publishedBy = '' } = {}) {
    const all = await Storage.listSlots();
    const ksb1Months = all
      .filter((s) => /^ksb1_\d{4}_\d{2}$/.test(String(s.slot || '')))
      .map((s) => ({
        slot: s.slot,
        fileName: s.fileName || '',
        uploadedAt: s.uploadedAt || '',
        meta: s.meta || {},
        rows: s.rows || []
      }))
      .sort((a, b) => String(a.slot).localeCompare(String(b.slot)));

    const forecasts = all
      .filter((s) => Storage.isForecastSlot(s.slot) && s.rows?.length)
      .map((s) => ({
        slot: s.slot,
        fileName: s.fileName || '',
        uploadedAt: s.uploadedAt || '',
        meta: s.meta || {},
        rows: s.rows || []
      }));

    const active = await Storage.loadActiveDataset();

    return {
      version: VERSION,
      publishedAt: new Date().toISOString(),
      publishedBy: String(publishedBy || '').trim(),
      preferredYear: Storage.getPreferredYear(2026),
      ksb1Months,
      forecasts,
      active: active?.rows?.length
        ? { meta: active.meta || {}, rows: active.rows }
        : null,
      summary: {
        ksb1Months: ksb1Months.length,
        ksb1Rows: ksb1Months.reduce((n, m) => n + (m.rows?.length || 0), 0),
        forecastSlots: forecasts.length,
        forecastRows: forecasts.reduce((n, f) => n + (f.rows?.length || 0), 0)
      }
    };
  }

  async function applyToStorage(pack) {
    if (!pack || Number(pack.version) !== VERSION) {
      throw new Error('Pacote compartilhado inválido ou versão incompatível.');
    }
    let wrote = 0;

    for (const m of pack.ksb1Months || []) {
      if (!m?.slot || !m.rows?.length) continue;
      await Storage.saveSlot(m.slot, {
        fileName: m.fileName || m.slot,
        uploadedAt: m.uploadedAt || pack.publishedAt,
        rows: m.rows,
        meta: { ...(m.meta || {}), fromSharedPack: true, sharedPublishedAt: pack.publishedAt },
        fileBlob: null,
        mimeType: 'application/json'
      });
      wrote += 1;
    }

    for (const f of pack.forecasts || []) {
      if (!f?.slot || !f.rows?.length) continue;
      await Storage.saveSlot(f.slot, {
        fileName: f.fileName || f.slot,
        uploadedAt: f.uploadedAt || pack.publishedAt,
        rows: f.rows,
        meta: { ...(f.meta || {}), fromSharedPack: true, sharedPublishedAt: pack.publishedAt },
        fileBlob: null,
        mimeType: 'application/json'
      });
      wrote += 1;
    }

    if (pack.active?.rows?.length) {
      await Storage.saveActiveDataset({
        meta: { ...(pack.active.meta || {}), fromSharedPack: true },
        rows: pack.active.rows
      });
      wrote += 1;
    }

    if (pack.preferredYear) Storage.setPreferredYear(pack.preferredYear);

    // Index KSB1
    const months = (pack.ksb1Months || [])
      .filter((m) => m?.slot)
      .map((m) => {
        const p = String(m.slot).match(/^ksb1_(\d{4})_(\d{2})$/);
        return p
          ? {
              key: m.slot,
              year: Number(p[1]),
              month: Number(p[2]),
              label: m.meta?.mesLabel || `${p[2]}/${p[1]}`,
              fileName: m.fileName,
              uploadedAt: m.uploadedAt,
              rowCount: m.rows?.length || 0
            }
          : null;
      })
      .filter(Boolean);

    if (months.length) {
      await Storage.saveSlot('ksb1_index', {
        fileName: 'ksb1-index',
        uploadedAt: pack.publishedAt,
        rows: [],
        meta: { kind: 'ksb1-index', months, fromSharedPack: true },
        fileBlob: null,
        mimeType: 'application/json'
      });
    }

    try {
      localStorage.setItem(APPLIED_KEY, pack.publishedAt || '');
      localStorage.setItem('tsoc-bfr-shared-meta', JSON.stringify({
        publishedAt: pack.publishedAt,
        publishedBy: pack.publishedBy,
        summary: pack.summary || {}
      }));
    } catch (_) { /* ignore */ }

    return { wrote, publishedAt: pack.publishedAt, publishedBy: pack.publishedBy, summary: pack.summary };
  }

  async function fetchFromRepo() {
    try {
      const res = await fetch(`${PACK_URL}?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return null;
      const json = await res.json();
      if (!json?.publishedAt) return null;
      return json;
    } catch (_) {
      return null;
    }
  }

  function alreadyApplied(publishedAt) {
    try {
      return localStorage.getItem(APPLIED_KEY) === String(publishedAt || '');
    } catch (_) {
      return false;
    }
  }

  function getLocalMeta() {
    try {
      return JSON.parse(localStorage.getItem('tsoc-bfr-shared-meta') || 'null');
    } catch (_) {
      return null;
    }
  }

  async function publishDownload({ publishedBy } = {}) {
    const pack = await buildFromStorage({ publishedBy });
    if (!(pack.ksb1Months.length || pack.forecasts.length || pack.active)) {
      throw new Error('Não há dados locais para publicar. Envie o Relatorio/KSB1 e atualize o app antes.');
    }
    downloadJson(pack, 'shared-pack.json');
    return pack;
  }

  async function importFile(file) {
    const text = await file.text();
    const pack = JSON.parse(text);
    return applyToStorage(pack);
  }

  async function syncFromRepo({ force = false } = {}) {
    const pack = await fetchFromRepo();
    if (!pack) return { applied: false, reason: 'none' };
    if (!force && alreadyApplied(pack.publishedAt)) {
      return { applied: false, reason: 'same', pack };
    }
    const result = await applyToStorage(pack);
    return { applied: true, reason: 'ok', pack, result };
  }

  return {
    PACK_URL,
    buildFromStorage,
    applyToStorage,
    fetchFromRepo,
    publishDownload,
    importFile,
    syncFromRepo,
    getLocalMeta,
    alreadyApplied
  };
})();
