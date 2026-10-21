/* Bootstrap do app TSOC BFR Custos */
(() => {
  const App = {
    seed: null,
    rows: [],
    meta: { unidades: [], tipos: [], setorMap: {} },
    slots: {},
    selectedYear: 2026,
    availableYears: [2026],
    yearMode: 'current',
    pendingApplyYear: null,
    ksb1Rows: [],
    ksb1HistoryRows: [],
    ksb1Meta: null,
    ksb1Months: [],
    ksb1ViewKey: 'all',
    ksb1Pending: null,
    ksb1LastAnalysis: null,
    /** Escopo multi-CC ao abrir KSB1 a partir de um setor (Detalhes). */
    ksb1CcScope: null
  };
  window.App = App;

  const KSB1_LEGACY_SLOT = 'ksb1';
  const KSB1_INDEX_SLOT = 'ksb1_index';
  const KSB1_ACTIVE_KEY = 'tsoc-bfr-ksb1-view';
  const KSB1_INDEX_LS = 'tsoc-bfr-ksb1-index-v1';

  function readKsb1Filters() {
    return {
      area: document.getElementById('filtro-ksb1-area')?.value || '',
      contrato: document.getElementById('filtro-ksb1-contrato')?.value || '',
      cc: document.getElementById('filtro-ksb1-cc')?.value || '',
      fornecedor: document.getElementById('filtro-ksb1-fornecedor')?.value || '',
      busca: document.getElementById('filtro-ksb1-busca')?.value || ''
    };
  }

  function getStoredKsb1ViewKey() {
    try {
      return localStorage.getItem(KSB1_ACTIVE_KEY) || 'all';
    } catch (_) {
      return 'all';
    }
  }

  function setStoredKsb1ViewKey(key) {
    try {
      localStorage.setItem(KSB1_ACTIVE_KEY, String(key || 'all'));
    } catch (_) { /* ignore */ }
  }

  function setAtualizarKsb1Ready(ready) {
    const btn = document.getElementById('btn-atualizar-ksb1');
    if (!btn) return;
    btn.disabled = !ready;
    btn.classList.toggle('is-ready', Boolean(ready));
  }

  function refreshContratos() {
    const filters = readKsb1Filters();
    if (App.ksb1CcScope?.length) filters.ccs = App.ksb1CcScope;
    const historyForGap = filters.area || filters.contrato
      ? Ksb1.filterRows(App.ksb1HistoryRows, { area: filters.area, contrato: filters.contrato })
      : App.ksb1HistoryRows;
    // Gap só nos contratos monitorados; a tabela de lançamentos usa a KSB1 completa
    const gapSource = (historyForGap || []).filter((r) => Ksb1.isMonitoredRow(r));
    // Meses em ordem cronológica para a linha do tempo
    const monthsAsc = [...App.ksb1Months].sort((a, b) => (a.year - b.year) || (a.month - b.month));
    const analysis = Ksb1.analyzeTimeline(gapSource, monthsAsc);
    App.ksb1LastAnalysis = analysis;
    UI.renderContratos(App.ksb1Rows, App.ksb1Meta, filters, {
      months: App.ksb1Months,
      viewKey: App.ksb1ViewKey,
      pending: App.ksb1Pending,
      analysis
    });
    setAtualizarKsb1Ready(Boolean(App.ksb1Pending));
  }

  function normCcKey(cc) {
    const s = String(cc || '').toUpperCase().trim();
    const m = s.match(/MW\d+[A-Z0-9]*/);
    return m ? m[0] : s.replace(/[^A-Z0-9]/g, '');
  }

  /** Abre a aba Contratos (KSB1) já filtrada pelos centros do detalhe. */
  async function openKsb1ForCcs(ccs, label) {
    const list = [...new Set((ccs || []).map(normCcKey).filter(Boolean))];
    UI.closeDrawer();

    ['filtro-ksb1-area', 'filtro-ksb1-contrato', 'filtro-ksb1-cc'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const forn = document.getElementById('filtro-ksb1-fornecedor');
    const busca = document.getElementById('filtro-ksb1-busca');
    if (forn) forn.value = '';
    if (busca) busca.value = '';
    UI.state.ksb1GapStatusFilter = 'all';

    App.ksb1CcScope = list.length > 1 ? list : null;

    if (App.ksb1ViewKey !== 'all' && App.ksb1Months.length) {
      try {
        await loadKsb1View('all');
      } catch (_) { /* segue com o que houver */ }
    }

    UI.setTab('contratos');
    refreshContratos();

    if (list.length === 1) {
      const ccEl = document.getElementById('filtro-ksb1-cc');
      if (ccEl) {
        if (![...ccEl.options].some((o) => normCcKey(o.value) === list[0])) {
          const opt = document.createElement('option');
          opt.value = list[0];
          opt.textContent = list[0];
          ccEl.appendChild(opt);
        }
        const match = [...ccEl.options].find((o) => normCcKey(o.value) === list[0]);
        ccEl.value = match ? match.value : list[0];
        App.ksb1CcScope = null;
        refreshContratos();
      }
    }

    const scoped = Ksb1.filterRows(App.ksb1Rows || [], list.length === 1
      ? { cc: list[0] }
      : { ccs: list });
    const n = scoped.length;
    const title = label || (list.length === 1 ? list[0] : `${list.length} centros`);
    UI.showToast(n
      ? `Contratos · ${title} · ${n.toLocaleString('pt-BR')} linha(s)`
      : `Contratos · ${title} · sem linhas — envie o extrato no Admin`);

    requestAnimationFrame(() => {
      document.querySelector('.contratos-lancamentos')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function openKsb1ContratoDetail(contratoKey) {
    const key = String(contratoKey || '');
    const contract = (App.ksb1LastAnalysis?.contracts || []).find((c) => c.key === key || c.contrato === key);
    if (!contract) {
      UI.showToast('Contrato não encontrado na análise de gap.');
      return;
    }
    UI.openContratoDrawer(contract, App.ksb1HistoryRows || []);
  }

  function readKsb1IndexLocal() {
    try {
      const raw = localStorage.getItem(KSB1_INDEX_LS);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed?.months) ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function writeKsb1IndexLocal(months) {
    const payload = {
      months: months || [],
      updatedAt: new Date().toISOString()
    };
    try {
      localStorage.setItem(KSB1_INDEX_LS, JSON.stringify(payload));
    } catch (_) { /* ignore */ }
    return payload;
  }

  async function persistKsb1Index(months) {
    const sorted = [...(months || [])].sort((a, b) => (b.year - a.year) || (b.month - a.month));
    const payload = writeKsb1IndexLocal(sorted);
    await Storage.saveSlot(KSB1_INDEX_SLOT, {
      fileName: 'ksb1-index',
      uploadedAt: payload.updatedAt,
      rows: [],
      meta: {
        kind: 'ksb1-index',
        months: sorted,
        updatedAt: payload.updatedAt
      }
    });
    return sorted;
  }

  async function syncKsb1IndexFromSlots(months) {
    return persistKsb1Index((months || []).map((m) => ({
      key: m.key,
      year: m.year,
      month: m.month,
      label: m.label,
      fileName: m.fileName || '',
      uploadedAt: m.uploadedAt || null,
      rowCount: m.rowCount || 0,
      total: m.total || 0
    })));
  }

  async function listKsb1MonthSlots() {
    const all = await Storage.listSlots();
    const fromDb = all
      .filter((s) => s?.rows?.length && Ksb1.parseSlotKey(s.slot))
      .map((s) => {
        const p = Ksb1.parseSlotKey(s.slot);
        return {
          key: s.slot,
          year: p.year,
          month: p.month,
          label: s.meta?.mesLabel || Ksb1.monthLabel(p.month, p.year),
          fileName: s.fileName,
          uploadedAt: s.uploadedAt,
          rowCount: s.rowCount || s.rows.length,
          total: s.meta?.total ?? s.rows.reduce((sum, r) => sum + (r.valor || 0), 0)
        };
      });

    // Mantém índice leve em sync (IndexedDB + localStorage) para não “sumir” a lista de meses
    if (fromDb.length) {
      await syncKsb1IndexFromSlots(fromDb);
    } else {
      const idxSlot = all.find((s) => s.slot === KSB1_INDEX_SLOT);
      const fromIdx = idxSlot?.meta?.months || readKsb1IndexLocal()?.months || [];
      if (fromIdx.length) {
        console.warn('Índice KSB1 existe, mas os dados mensais não foram encontrados na IndexedDB.');
      }
    }

    return fromDb.sort((a, b) => (b.year - a.year) || (b.month - a.month));
  }

  async function migrateLegacyKsb1() {
    const legacy = await Storage.getSlot(KSB1_LEGACY_SLOT);
    if (!legacy?.rows?.length) return;
    try {
      const period = Ksb1.detectPeriod(legacy.rows, legacy.fileName || '', seedYear());
      const existing = await Storage.getSlot(period.key);
      if (!existing?.rows?.length) {
        const rows = Ksb1.tagRowsWithPeriod(legacy.rows, period);
        await Storage.saveSlot(period.key, {
          fileName: legacy.fileName,
          uploadedAt: legacy.uploadedAt,
          rows,
          meta: {
            ...(legacy.meta || {}),
            kind: 'ksb1-month',
            year: period.year,
            month: period.month,
            mesLabel: period.label,
            migratedFrom: KSB1_LEGACY_SLOT
          },
          fileBlob: legacy.fileBlob || null,
          mimeType: legacy.mimeType || 'application/octet-stream'
        });
      }
      await Storage.clearSlot(KSB1_LEGACY_SLOT);
    } catch (err) {
      console.warn('Migração KSB1 legada ignorada:', err);
    }
  }

  async function loadKsb1View(viewKey) {
    App.ksb1Months = await listKsb1MonthSlots();
    let key = viewKey || App.ksb1ViewKey || getStoredKsb1ViewKey();
    if (key !== 'all' && !App.ksb1Months.some((m) => m.key === key)) {
      key = App.ksb1Months[0]?.key || 'all';
    }
    App.ksb1ViewKey = key;
    setStoredKsb1ViewKey(key);

    if (!App.ksb1Months.length) {
      App.ksb1Rows = [];
      App.ksb1HistoryRows = [];
      App.ksb1Meta = App.ksb1Pending
        ? {
            ...App.ksb1Pending.meta,
            pending: true,
            fileName: App.ksb1Pending.fileName,
            uploadedAt: App.ksb1Pending.uploadedAt
          }
        : null;
      refreshContratos();
      return;
    }

    const packs = await Promise.all(App.ksb1Months.map((m) => Storage.getSlot(m.key)));
    App.ksb1HistoryRows = packs.flatMap((p) => p?.rows || []);

    if (key === 'all') {
      App.ksb1Rows = App.ksb1HistoryRows;
      App.ksb1Meta = {
        fileName: `${App.ksb1Months.length} mês(es) no histórico`,
        source: 'histórico Contratos',
        uploadedAt: App.ksb1Months[0]?.uploadedAt || null,
        rowCount: App.ksb1HistoryRows.length,
        total: App.ksb1HistoryRows.reduce((s, r) => s + (r.valor || 0), 0),
        areas: [...new Set(App.ksb1HistoryRows.map((r) => r.area))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
        viewKey: 'all',
        months: App.ksb1Months
      };
    } else {
      const saved = packs.find((p) => p?.slot === key) || await Storage.getSlot(key);
      App.ksb1Rows = saved?.rows || [];
      App.ksb1Meta = {
        ...(saved?.meta || {}),
        fileName: saved?.fileName,
        uploadedAt: saved?.uploadedAt,
        viewKey: key,
        months: App.ksb1Months
      };
    }
    refreshContratos();
  }

  async function loadKsb1FromStorage() {
    await migrateLegacyKsb1();
    try {
      await repairKsb1MultiMonthSlots();
    } catch (err) {
      console.warn('Reparo KSB1 multi-mês ignorado:', err);
    }
    await loadKsb1View(getStoredKsb1ViewKey());
  }

  /** Upload: só prepara; histórico + ACT do Relatorio mudam ao clicar Atualizar app (KSB1). */
  async function stageKsb1Files(fileList) {
    const files = [...(fileList || [])];
    if (!files.length) return;
    if (!Auth.isLoggedIn()) {
      UI.showToast('Entre no Admin (CWID) para enviar Contratos.');
      UI.setTab('admin');
      return;
    }
    // Todas as linhas do extrato de Contratos (não só monitorados) — alimenta Relatorio ACT + lançamentos
    const parsed = await Ksb1.parseFiles(files, { onlyMonitored: false });
    if (!parsed.rows.length) {
      throw new Error('Nenhuma linha válida em Contratos (Cost Center + valor).');
    }
    const tagged = Ksb1.tagRowsWithOwnPeriod(parsed.rows, {
      fallbackYear: seedYear(),
      fileName: files[0].name
    });
    const byMonth = Ksb1.groupRowsByMonth(tagged.rows);
    if (!byMonth.length) {
      throw new Error('Não foi possível separar os meses pela coluna Period.');
    }
    const period = byMonth[byMonth.length - 1].period;
    const uploadedAt = new Date().toISOString();
    const monthLabels = byMonth.map((g) => g.period.label);
    const nMonitored = tagged.rows.filter((r) => Ksb1.isMonitoredRow(r)).length;
    App.ksb1Pending = {
      rows: tagged.rows,
      byMonth,
      file: files[0],
      fileName: parsed.meta.source,
      uploadedAt,
      uploadedBy: Auth.getSession()?.cwid || '',
      period,
      meta: {
        ...parsed.meta,
        kind: byMonth.length > 1 ? 'ksb1-ytd' : 'ksb1-month',
        year: period.year,
        month: period.month,
        mesLabel: period.label,
        mesKey: period.key,
        months: monthLabels,
        monthCount: byMonth.length,
        fileName: parsed.meta.source,
        uploadedAt,
        pending: true,
        missingPeriod: tagged.missing || 0,
        monitoredCount: nMonitored,
        updateRelatorioAct: true
      }
    };
    setAtualizarKsb1Ready(true);
    refreshContratos();
    const nAll = tagged.rows.length.toLocaleString('pt-BR');
    const nMon = nMonitored.toLocaleString('pt-BR');
    const span = byMonth.length > 1
      ? `${byMonth.length} meses (${monthLabels[0]} → ${monthLabels[monthLabels.length - 1]})`
      : period.label;
    UI.showToast(`${span}: ${nAll} linhas de Contratos prontas (atualiza Relatorio + lançamentos).`);
    UI.setTab('admin');
    const adminMsg = document.getElementById('ksb1-admin-msg');
    if (adminMsg) {
      adminMsg.textContent = `${span}: ${nAll} linhas (${nMon} monitoradas). Clique em 2. Atualizar app (Contratos) — grava lançamentos e ACT do Relatorio.`;
    }
  }

  /** Usa a KSB1 completa para atualizar o ACT (realizado) do Relatorio no app. */
  async function applyKsb1ToRelatorio(ksb1Rows) {
    const rows = ksb1Rows || [];
    if (!rows.length) return { years: [], totalMatched: 0, totalCreated: 0 };

    const years = [...new Set(rows.map((r) => Number(r.ano)).filter((y) => y >= 2000 && y <= 2100))];
    if (!years.length) years.push(seedYear());

    let totalMatched = 0;
    let totalCreated = 0;
    const touchedYears = [];

    for (const year of years.sort((a, b) => a - b)) {
      const actPack = Ksb1.aggregateRelatorioAct(rows, { year });
      if (!actPack.keyCount || !actPack.monthsTouched.length) continue;

      const slotList = await Storage.listSlots();
      const yearSlots = Storage.slotsForYear(slotList, year);
      const hasUploads = Storage.FORECASTS.some((k) => yearSlots[k]?.rows?.length);
      const seedRows = year === seedYear() ? (App.seed?.rows || []) : [];
      const baseRows = hasUploads
        ? Parser.mergeSlots(yearSlots, seedRows)
        : seedRows.map((r) => ({
          ...r,
          bud: { ...Parser.emptyMonths(), ...(r.bud || {}) },
          fc1: { ...Parser.emptyMonths(), ...(r.fc1 || {}) },
          fc2: { ...Parser.emptyMonths(), ...(r.fc2 || {}) },
          fc3: { ...Parser.emptyMonths(), ...(r.fc3 || {}) },
          act: { ...Parser.emptyMonths(), ...(r.act || {}) }
        }));

      const ccLookup = Parser.buildCcLookup(baseRows.length ? baseRows : seedRows);
      const { rows: patched, stats } = Parser.applyKsb1Act(baseRows, actPack, { ccLookup });
      if (!patched.length) continue;

      await saveYearDataset(year, patched, {
        fileName: `Contratos → Relatorio ACT ${year}`,
        source: 'Contratos ACT',
        forecast: 'fc3'
      });
      totalMatched += stats.matched;
      totalCreated += stats.created;
      touchedYears.push({
        year,
        months: stats.months,
        matched: stats.matched,
        created: stats.created
      });
    }

    return { years: touchedYears, totalMatched, totalCreated };
  }

  async function applyKsb1Pending() {
    if (!Auth.isLoggedIn()) {
      UI.showToast('Entre no Admin (CWID) para atualizar os contratos.');
      UI.setTab('admin');
      return;
    }
    const pending = App.ksb1Pending;
    if (!pending?.rows?.length) {
      UI.showToast('Envie um arquivo de Contratos antes de atualizar.');
      return;
    }
    const { byMonth, meta, fileName, uploadedAt, period } = pending;
    const buckets = (byMonth && byMonth.length)
      ? byMonth
      : Ksb1.groupRowsByMonth(pending.rows);
    if (!buckets.length) {
      UI.showToast('Nenhum mês válido para gravar.');
      return;
    }

    let updated = 0;
    let created = 0;
    let fileBlob = null;
    let mimeType = 'application/octet-stream';
    try {
      if (pending.file) {
        const buf = await pending.file.arrayBuffer();
        mimeType = pending.file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        fileBlob = new Blob([buf], { type: mimeType });
      }
    } catch (_) {
      fileBlob = null;
    }
    for (const bucket of buckets) {
      const previous = await Storage.getSlot(bucket.period.key);
      if (previous?.rows?.length) updated += 1;
      else created += 1;
      await Storage.saveSlot(bucket.period.key, {
        fileName,
        uploadedAt,
        rows: bucket.rows,
        meta: {
          ...meta,
          kind: 'ksb1-month',
          year: bucket.period.year,
          month: bucket.period.month,
          mesLabel: bucket.period.label,
          mesKey: bucket.period.key,
          total: bucket.total,
          rowCount: bucket.rows.length,
          pending: false,
          replacedPrevious: Boolean(previous?.rows?.length),
          previousUploadedAt: previous?.uploadedAt || null,
          persistedAt: new Date().toISOString(),
          sourceFile: fileName,
          fromYtd: buckets.length > 1
        },
        // Guarda o arquivo original (como o Relatorio) para o botão Baixar
        fileBlob: buckets.length === 1 ? fileBlob : null,
        mimeType: fileBlob ? mimeType : 'application/json'
      });
    }

    const monthsNow = await listKsb1MonthSlots();
    await syncKsb1IndexFromSlots(monthsNow);

    App.ksb1Pending = null;
    setAtualizarKsb1Ready(false);
    const focus = period?.key || buckets[buckets.length - 1].period.key;
    await loadKsb1View(buckets.length > 1 ? 'all' : focus);

    // Atualiza o ACT do Relatorio (realizado) com a KSB1 completa — um envio só
    let actInfo = { years: [], totalMatched: 0, totalCreated: 0 };
    try {
      actInfo = await applyKsb1ToRelatorio(pending.rows);
      const actYear = actInfo.years[0]?.year || period?.year || App.selectedYear || seedYear();
      App.selectedYear = actYear;
      Storage.setPreferredYear(actYear);
      await rebuildDataset({ year: actYear });
    } catch (err) {
      console.error('Contratos → Relatorio ACT:', err);
      UI.showToast('Contratos gravados, mas falhou ao atualizar o ACT do Relatorio.');
    }

    const slotList = await Storage.listSlots();
    refreshAdminUi(slotList);
    const span = buckets.length > 1
      ? `${buckets.length} meses gravados (${buckets[0].period.label} → ${buckets[buckets.length - 1].period.label})`
      : buckets[0].period.label;
    const actTxt = actInfo.years.length
      ? ` · Relatorio ACT: ${actInfo.totalMatched} conta(s) + ${actInfo.totalCreated} nova(s)`
      : '';
    const adminMsg = document.getElementById('ksb1-admin-msg');
    if (adminMsg) {
      adminMsg.textContent = `App atualizado com Contratos: ${span} · ${monthsNow.length} mês(es) no histórico${actTxt}.`;
    }
    UI.showToast(`App atualizado (Contratos + Relatorio): ${span}${actTxt}`);
    UI.setTab('admin');
  }

  /** Corrige slots antigos em que um YTD foi gravado todo como um único mês. */
  async function repairKsb1MultiMonthSlots() {
    const all = await Storage.listSlots();
    const monthSlots = all.filter((s) => s?.rows?.length && Ksb1.parseSlotKey(s.slot));
    let changed = false;
    for (const slot of monthSlots) {
      const reclass = Ksb1.reclassifyRows(slot.rows);
      const baseRows = reclass.changed ? reclass.rows : slot.rows;
      if (reclass.changed) {
        await Storage.saveSlot(slot.slot, {
          fileName: slot.fileName,
          uploadedAt: slot.uploadedAt,
          rows: baseRows,
          meta: { ...(slot.meta || {}), reclassifiedAt: new Date().toISOString(), reclassified: reclass.changed },
          fileBlob: null,
          mimeType: slot.mimeType || 'application/json'
        });
        changed = true;
        slot.rows = baseRows;
      }
      const retagged = Ksb1.tagRowsWithOwnPeriod(baseRows, {
        fallbackYear: Ksb1.parseSlotKey(slot.slot)?.year || seedYear(),
        fileName: slot.fileName || ''
      });
      const groups = Ksb1.groupRowsByMonth(retagged.rows);
      if (groups.length <= 1) {
        // Garante mesKey coerente mesmo em slot de um mês
        const only = groups[0];
        if (only && only.period.key === slot.slot) {
          const needsFix = slot.rows.some((r) => r.mesKey && r.mesKey !== slot.slot);
          if (needsFix) {
            await Storage.saveSlot(slot.slot, {
              fileName: slot.fileName,
              uploadedAt: slot.uploadedAt,
              rows: only.rows,
              meta: { ...(slot.meta || {}), mesKey: slot.slot, mesLabel: only.period.label, repairedAt: new Date().toISOString() },
              fileBlob: null,
              mimeType: slot.mimeType || 'application/json'
            });
            changed = true;
          }
        }
        continue;
      }
      // Slot misturado: reparte para ksb1_YYYY_MM de cada Period
      for (const bucket of groups) {
        const existing = await Storage.getSlot(bucket.period.key);
        // Se o destino já tem dados de outro arquivo e não é o slot origem, só sobrescreve
        // quando o destino está vazio OU é o próprio slot sendo repartido OU veio do mesmo YTD mal gravado
        const shouldWrite = !existing?.rows?.length
          || bucket.period.key === slot.slot
          || existing.meta?.fromYtd
          || existing.fileName === slot.fileName;
        if (!shouldWrite && existing.rows.length >= bucket.rows.length) continue;
        await Storage.saveSlot(bucket.period.key, {
          fileName: slot.fileName,
          uploadedAt: slot.uploadedAt || new Date().toISOString(),
          rows: bucket.rows,
          meta: {
            ...(slot.meta || {}),
            kind: 'ksb1-month',
            year: bucket.period.year,
            month: bucket.period.month,
            mesLabel: bucket.period.label,
            mesKey: bucket.period.key,
            total: bucket.total,
            rowCount: bucket.rows.length,
            repairedFrom: slot.slot,
            repairedAt: new Date().toISOString()
          },
          fileBlob: null,
          mimeType: 'application/json'
        });
        changed = true;
      }
      // Se o slot original não corresponde a nenhum grupo restante com esse key, e foi tudo redistribuído, limpa se ficou só lixo
      const still = groups.find((g) => g.period.key === slot.slot);
      if (!still) {
        await Storage.clearSlot(slot.slot);
        changed = true;
      }
    }
    if (changed) {
      const monthsNow = await listKsb1MonthSlots();
      await syncKsb1IndexFromSlots(monthsNow);
    }
    return changed;
  }

  async function clearKsb1Month() {
    if (!Auth.isLoggedIn()) {
      UI.showToast('Entre no Admin (CWID) para remover um mês de Contratos.');
      return;
    }
    if (App.ksb1Pending) {
      App.ksb1Pending = null;
      setAtualizarKsb1Ready(false);
      refreshContratos();
      UI.showToast('Envio pendente cancelado.');
      return;
    }
    const key = App.ksb1ViewKey;
    if (!key || key === 'all') {
      UI.showToast('Selecione um mês específico para remover do histórico.');
      return;
    }
    const info = App.ksb1Months.find((m) => m.key === key);
    await Storage.clearSlot(key);
    const monthsNow = await listKsb1MonthSlots();
    await syncKsb1IndexFromSlots(monthsNow);
    await loadKsb1View('all');
    UI.showToast(`${info?.label || 'Mês'} removido. Restam ${monthsNow.length} mês(es) no histórico.`);
  }

  function seedYear() {
    return Number(App.seed?.meta?.year) || 2026;
  }

  function yearOptionList(extraYears = []) {
    const base = seedYear();
    const years = new Set([App.selectedYear, ...extraYears.map(Number)].filter((y) => y >= 2000 && y <= 2100));
    for (let y = base + 1; y >= base - 5; y -= 1) years.add(y);
    return [...years].sort((a, b) => b - a);
  }

  async function loadSeed() {
    const res = await fetch('data/seed.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('Não foi possível carregar data/seed.json');
    const json = await res.json();
    App.seed = json;
    return json;
  }

  function refreshAuthLists() {
    UI.renderCwidList(Auth.getAuthorizedEntries());
  }

  function refreshActions() {
    const filters = {
      mes: document.getElementById('filtro-acao-mes')?.value || '',
      setor: document.getElementById('filtro-acao-setor')?.value || '',
      quem: document.getElementById('filtro-acao-quem')?.value || '',
      status: document.getElementById('filtro-acao-status')?.value || ''
    };
    UI.renderActions(Actions.filterActions(filters));
  }

  function showAdminForSession() {
    const loggedIn = Auth.isLoggedIn();
    UI.syncAdminAuthUi(loggedIn);
    if (loggedIn) refreshAuthLists();
    setAtualizarAppReady(Boolean(App.pendingApplyYear));
    refreshSharedPublishMsg();
  }

  window.onAdminTabShow = showAdminForSession;

  function refreshSharedPublishMsg() {
    const el = document.getElementById('shared-publish-msg');
    if (!el) return;
    const meta = SharedPack.getLocalMeta();
    if (!meta?.publishedAt) {
      el.textContent = 'Nenhuma publicação aplicada ainda. Publique após atualizar os dados, ou faça Pull no GitHub.';
      return;
    }
    const when = new Date(meta.publishedAt).toLocaleString('pt-BR');
    const by = meta.publishedBy ? ` por ${meta.publishedBy}` : '';
    const s = meta.summary || {};
    el.textContent = `Base do time: ${when}${by} · KSB1 ${s.ksb1Months || 0} mês(es) · forecast ${s.forecastSlots || 0} slot(s).`;
  }

  async function publishSharedPack() {
    if (!Auth.isLoggedIn()) {
      UI.showToast('Faça login no Admin para publicar.');
      UI.setTab('admin');
      return;
    }
    const msg = document.getElementById('shared-publish-msg');
    try {
      const pack = await SharedPack.publishDownload({
        publishedBy: Auth.getSession()?.cwid || ''
      });
      if (msg) {
        msg.textContent = `Arquivo baixado. Substitua data/shared-pack.json e faça Push no GitHub Desktop. `
          + `(${pack.summary.ksb1Months} mês(es) KSB1 · ${pack.summary.forecastSlots} forecast)`;
      }
      UI.showToast('shared-pack.json baixado — salve em data/ e faça Push.');
    } catch (err) {
      console.error(err);
      if (msg) msg.textContent = err.message || 'Falha ao publicar.';
      UI.showToast(err.message || 'Não foi possível publicar.');
    }
  }

  async function importSharedPackFile(file) {
    if (!file) return;
    if (!Auth.isLoggedIn()) {
      UI.showToast('Faça login no Admin para importar.');
      return;
    }
    const msg = document.getElementById('shared-publish-msg');
    try {
      const result = await SharedPack.importFile(file);
      App.selectedYear = Storage.getPreferredYear(seedYear());
      await rebuildDataset({ persist: true, year: App.selectedYear });
      await loadKsb1FromStorage();
      refreshSharedPublishMsg();
      if (msg) {
        msg.textContent = `Pack importado (${result.publishedAt}). ${result.wrote} slot(s) gravados.`;
      }
      UI.showToast('Dados do pack aplicados neste notebook.');
    } catch (err) {
      console.error(err);
      if (msg) msg.textContent = err.message || 'Falha ao importar.';
      UI.showToast(err.message || 'Não foi possível importar o pack.');
    }
  }

  async function syncSharedPackFromRepo() {
    try {
      const sync = await SharedPack.syncFromRepo();
      if (!sync.applied) {
        refreshSharedPublishMsg();
        return sync;
      }
      if (sync.pack?.preferredYear) App.selectedYear = Number(sync.pack.preferredYear) || App.selectedYear;
      await rebuildDataset({ persist: true, year: App.selectedYear });
      await loadKsb1FromStorage();
      refreshSharedPublishMsg();
      const by = sync.pack?.publishedBy ? ` por ${sync.pack.publishedBy}` : '';
      UI.showToast(`Dados do time atualizados${by}.`);
      const chip = document.getElementById('chip-fonte');
      if (chip && sync.pack?.publishedAt) {
        const when = new Date(sync.pack.publishedAt).toLocaleDateString('pt-BR');
        chip.textContent = `Base do time · ${when}${by}`;
      }
      return sync;
    } catch (err) {
      console.warn('Shared pack sync:', err);
      return { applied: false, reason: 'error' };
    }
  }

  function refreshAdminUi(slotList) {
    const versions = Storage.versionsByForecast(slotList, seedYear());
    UI.renderAdminSlots(versions, yearOptionList(App.availableYears), App.selectedYear);
    UI.renderAdminKsb1Slots(App.ksb1Months || []);
  }

  function rowKey(r) {
    return `${r.cc}||${r.conta}||${r.tipo}||${r.unidade}||${r.setor}`;
  }

  function attachYearOverYear(currentRows, priorRows) {
    if (!currentRows?.length) return { rows: [], mode: 'empty' };
    if (!priorRows?.length) {
      return {
        rows: currentRows.map((r) => ({
          ...r,
          bud: Parser.emptyMonths(),
          fc1: Parser.emptyMonths(),
          fc2: Parser.emptyMonths(),
          fc3: Parser.emptyMonths()
        })),
        mode: 'py-only'
      };
    }

    const priorActByKey = new Map();
    priorRows.forEach((r) => {
      priorActByKey.set(rowKey(r), { ...Parser.emptyMonths(), ...(r.act || {}) });
    });

    const currentKeys = new Set();
    const rows = currentRows.map((r) => {
      const k = rowKey(r);
      currentKeys.add(k);
      const prior = priorActByKey.get(k) || Parser.emptyMonths();
      return {
        ...r,
        bud: { ...prior },
        fc1: { ...prior },
        fc2: { ...prior },
        fc3: { ...prior },
        yoy: true
      };
    });

    // Contas só no ano anterior entram com realizado 0 para o total previsto bater com o PY completo
    priorRows.forEach((r) => {
      const k = rowKey(r);
      if (currentKeys.has(k)) return;
      const prior = priorActByKey.get(k) || Parser.emptyMonths();
      const has = Parser.MONTHS.some((m) => (prior[m] || 0) !== 0);
      if (!has) return;
      rows.push({
        ...r,
        act: Parser.emptyMonths(),
        bud: { ...prior },
        fc1: { ...prior },
        fc2: { ...prior },
        fc3: { ...prior },
        yoy: true,
        source: 'py-prior-only'
      });
    });

    return { rows, mode: 'yoy' };
  }

  async function rebuildDataset({ persist = true, year } = {}) {
    const slotList = await Storage.listSlots();
    App.availableYears = Storage.listAvailableYears(slotList, seedYear());
    const preferred = Number(year) || App.selectedYear || Storage.getPreferredYear(seedYear());
    App.selectedYear = App.availableYears.includes(preferred) ? preferred : (App.availableYears[0] || seedYear());
    Storage.setPreferredYear(App.selectedYear);

    const yearSlots = Storage.slotsForYear(slotList, App.selectedYear);
    App.slots = yearSlots;

    const hasUploads = Storage.FORECASTS.some((k) => yearSlots[k]?.rows?.length);
    const useSeed = App.selectedYear === seedYear();
    const baseRows = useSeed ? (App.seed?.rows || []) : [];
    let rows = hasUploads
      ? Parser.mergeSlots(yearSlots, baseRows)
      : baseRows.slice();

    // Anos PY (anteriores): realizado = PY do ano; previsto = PY do ano anterior (YoY)
    const isPriorYear = App.selectedYear < seedYear()
      || rows.some((r) => r.source === 'py');
    App.yearMode = 'current';
    if (isPriorYear && App.selectedYear !== seedYear()) {
      // Limpa espelhamento antigo (bud/fc = act) antes de montar YoY
      rows = rows.map((r) => ({
        ...r,
        bud: Parser.emptyMonths(),
        fc1: Parser.emptyMonths(),
        fc2: Parser.emptyMonths(),
        fc3: Parser.emptyMonths()
      }));
      const priorSlots = Storage.slotsForYear(slotList, App.selectedYear - 1);
      const priorHas = Storage.FORECASTS.some((k) => priorSlots[k]?.rows?.length);
      const priorRows = priorHas ? Parser.mergeSlots(priorSlots, []) : [];
      const attached = attachYearOverYear(rows, priorRows);
      rows = attached.rows;
      App.yearMode = attached.mode;
    }

    App.rows = rows;
    App.meta = Engine.metaFromRows(rows);

    if (persist) {
      await Storage.saveActiveDataset({
        meta: {
          source: hasUploads ? `Mescla ${App.selectedYear}` : (App.seed?.meta?.source || 'seed'),
          rowCount: rows.length,
          year: App.selectedYear,
          yearMode: App.yearMode
        },
        rows
      });
      Storage.cacheMeta({
        source: hasUploads ? `Uploads ${App.selectedYear}` : 'Seed FC3',
        rowCount: rows.length
      });
    }

    const chip = document.getElementById('chip-fonte');
    const loadedSlots = Storage.FORECASTS.filter((k) => yearSlots[k]).length;
    if (!rows.length) {
      chip.textContent = `Sem dados para ${App.selectedYear} · faça upload no Admin`;
    } else if (App.yearMode === 'yoy') {
      chip.textContent = `${App.selectedYear} (PY) vs ${App.selectedYear - 1} · ${App.meta.ccCount} CCs`;
    } else if (App.yearMode === 'py-only') {
      chip.textContent = `${App.selectedYear} (PY realizado) · ${App.meta.ccCount} CCs`;
    } else if (hasUploads) {
      chip.textContent = `${App.selectedYear} · ${loadedSlots}/4 forecasts · ${App.meta.ccCount} CCs`;
    } else {
      chip.textContent = `${App.selectedYear} · Dados iniciais FC3 · ${App.meta.ccCount} CCs`;
    }

    setYearLabels(App.selectedYear);
    UI.populateYearFilter(yearOptionList(App.availableYears), App.selectedYear);
    UI.syncYearModeUi(App.yearMode, App.selectedYear);
    UI.populateFilters(App.meta);
    UI.renderHomeSnapshot(App.rows);
    refreshOverviewChart();
    refreshAdminUi(slotList);
    refreshDetails();
  }

  function refreshOverviewChart() {
    const base = UI.readFilters();
    const mesData = Engine.waterfallByGroup(App.rows, { ...base, periodo: 'mes' });
    const ytdData = Engine.waterfallByGroup(App.rows, { ...base, periodo: 'ytd' });
    UI.renderExecWaterfalls(mesData, ytdData);
  }

  function refreshDetails() {
    const filters = UI.readFilters();
    const ccList = Engine.aggregateCostCenters(App.rows, filters);
    const sectorList = Engine.aggregateSectors(ccList);
    const sum = Engine.summary(ccList, filters, {
      yearMode: App.yearMode,
      year: App.selectedYear
    });
    UI.renderKpis(sum);
    UI.renderRanking(sectorList);
    UI.renderHomeSnapshot(App.rows);
    refreshOverviewChart();
  }

  function setYearLabels(year) {
    const y = String(year || App.selectedYear || seedYear());
    const a = document.getElementById('label-ano');
    const b = document.getElementById('label-ano-footer');
    if (a) a.textContent = y;
    if (b) b.textContent = y;
  }

  async function switchYear(nextYear) {
    const y = Number(nextYear);
    if (!y || y === App.selectedYear) return;
    const hist = document.getElementById('filtro-historico');
    if (hist) hist.value = '';
    App.selectedYear = y;
    Storage.setPreferredYear(y);
    await rebuildDataset({ year: y });
    UI.showToast(`Analisando o ano ${y}.`);
  }

  async function refreshHistorySelect() {
    const select = document.getElementById('filtro-historico');
    if (!select) return;
    const current = select.value;
    const histories = await Storage.listHistories();
    select.innerHTML = '<option value="">Mês atual (em edição)</option>';
    histories.forEach((h) => {
      const opt = document.createElement('option');
      opt.value = h.slot;
      const mesLabel = Engine.MONTH_LABELS[h.meta?.mes] || h.meta?.mes || '';
      opt.textContent = h.meta?.label || `${h.meta?.year || ''} · ${mesLabel} · ${new Date(h.uploadedAt).toLocaleDateString('pt-BR')}`;
      select.appendChild(opt);
    });
    if ([...select.options].some((o) => o.value === current)) select.value = current;
  }

  async function saveCurrentHistory() {
    const filters = UI.readFilters();
    const year = App.selectedYear || seedYear();
    const mesLabel = Engine.MONTH_LABELS[filters.mes] || filters.mes;
    await Storage.saveHistory({
      year,
      mes: filters.mes,
      label: `${year} · ${mesLabel}`,
      scenario: filters.scenario,
      savedAt: new Date().toISOString(),
      rows: App.rows
    });
    await refreshHistorySelect();
    UI.showToast(`Histórico de ${mesLabel}/${year} salvo. Você poderá restaurá-lo depois.`);
  }

  async function restoreHistory(slot) {
    if (!slot) {
      // volta ao dataset ativo
      const active = await Storage.loadActiveDataset();
      if (active?.rows?.length) {
        App.rows = active.rows;
        App.meta = Engine.metaFromRows(App.rows);
        UI.populateFilters(App.meta);
        UI.renderHomeSnapshot(App.rows);
        refreshDetails();
        UI.showToast('Voltou ao mês atual em edição.');
      }
      return;
    }
    const hist = await Storage.loadHistory(slot);
    if (!hist?.rows?.length) {
      UI.showToast('Histórico não encontrado.');
      return;
    }
    App.rows = hist.rows;
    App.meta = Engine.metaFromRows(App.rows);
    if (hist.meta?.mes) document.getElementById('filtro-mes').value = hist.meta.mes;
    setYearLabels(hist.meta?.year || App.selectedYear || seedYear());
    if (hist.meta?.year) {
      App.selectedYear = Number(hist.meta.year);
      Storage.setPreferredYear(App.selectedYear);
      UI.populateYearFilter(yearOptionList([App.selectedYear, ...App.availableYears]), App.selectedYear);
    }
    UI.populateFilters(App.meta);
    UI.renderHomeSnapshot(App.rows);
    refreshDetails();
    UI.showToast(`Histórico restaurado: ${hist.meta?.label || hist.fileName}`);
  }

  function findCcDetail(cc, unidade, setor) {
    const filters = UI.readFilters();
    const scoped = {
      ...filters,
      unidade: unidade || filters.unidade,
      setor: setor || filters.setor,
      busca: cc.toLowerCase()
    };
    const list = Engine.aggregateCostCenters(App.rows, scoped);
    return list.find((x) => x.cc === cc && (!unidade || x.unidade === unidade) && (!setor || x.setor === setor))
      || list.find((x) => x.cc === cc);
  }

  function openCc(cc, unidade, setor) {
    const detail = findCcDetail(cc, unidade, setor);
    const code = detail?.cc || cc;
    if (!code) {
      UI.showToast('Centro de custo não encontrado para os filtros atuais.');
      return;
    }
    openKsb1ForCcs([code], code);
  }

  function openSetor(unidade, setor) {
    if (!setor) {
      UI.showToast('Setor não informado.');
      return;
    }
    const filters = UI.readFilters();
    const scoped = {
      ...filters,
      unidade: unidade || filters.unidade,
      setor
    };
    const ccList = Engine.aggregateCostCenters(App.rows, scoped);
    const sectors = Engine.aggregateSectors(ccList);
    const detail = sectors.find((s) => s.setor === setor && (!unidade || s.unidade === unidade))
      || sectors[0];
    if (!detail) {
      UI.showToast('Setor não encontrado para os filtros atuais.');
      return;
    }
    const ccs = detail.ccCodes?.length
      ? detail.ccCodes
      : (detail.accounts || []).map((a) => a.cc).filter(Boolean);
    openKsb1ForCcs(ccs, setor);
  }

  function exportCsv() {
    const filters = UI.readFilters();
    const ccList = Engine.aggregateCostCenters(App.rows, filters);
    const csv = Engine.toCsv(ccList, filters);
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    Storage.downloadBlob(blob, `tsoc-bfr-detalhes-${filters.scenario}-${filters.mes}.csv`);
    UI.showToast('CSV da aba Detalhes baixado.');
  }

  function exportXlsx() {
    if (typeof XLSX === 'undefined') {
      UI.showToast('Biblioteca Excel indisponível.');
      return;
    }
    const filters = UI.readFilters();
    const ccList = Engine.sortAttention(Engine.aggregateCostCenters(App.rows, filters));
    const rows = ccList.map((r) => ({
      Unidade: r.unidade,
      Setor: r.setor,
      'Centro de custo': r.cc,
      Nome: r.ccNome,
      Previsto: r.previsto,
      Realizado: r.realizado,
      Diferença: r.diff,
      Situação: r.situacao.label,
      Cenário: Engine.SCENARIO_LABELS[filters.scenario],
      Período: filters.periodo,
      Mês: filters.mes
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Detalhes');
    const out = XLSX.write(book, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([out], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    Storage.downloadBlob(blob, `tsoc-bfr-detalhes-${filters.scenario}-${filters.mes}.xlsx`);
    UI.showToast('Excel da aba Detalhes baixado.');
  }

  async function saveYearDataset(year, rows, { fileName, fileBlob, mimeType, source, forecast = 'fc3' } = {}) {
    const y = Number(year);
    if (!y || !rows?.length) return;
    // Grava nos 4 slots para o ano ficar disponível em qualquer cenário
    for (const slot of Storage.FORECASTS) {
      const key = Storage.slotKey(slot, y);
      await Storage.saveSlot(key, {
        fileName: fileName || `relatorio-py-${y}.xlsx`,
        uploadedAt: new Date().toISOString(),
        rows,
        meta: {
          slot,
          year: y,
          source: source || (y === seedYear() ? 'Relatorio' : 'PY Relatorio'),
          uploadedBy: Auth.getSession()?.cwid || ''
        },
        fileBlob: slot === forecast ? (fileBlob || null) : null,
        mimeType: mimeType || 'application/octet-stream'
      });
    }
  }

  async function handleUpload(forecast, file, year) {
    if (!Auth.isLoggedIn()) {
      UI.showToast('Faça login com CWID Bayer para enviar planilhas.');
      return;
    }
    const y = Number(year) || App.selectedYear || seedYear();
    const msg = document.getElementById('admin-msg');
    msg.textContent = `Lendo Relatorio de ${file.name}…`;
    try {
      const parsed = await Parser.parseFile(file);
      const yearsMap = parsed.years || {};
      const currentYear = Number(parsed.currentYear) || y;
      const currentRows = yearsMap[currentYear] || parsed.rows || [];
      if (!currentRows.length && !Object.values(yearsMap).some((r) => r?.length)) {
        throw new Error('Nenhuma linha válida na aba Relatorio (centros MW…).');
      }

      const fileBlob = await file.arrayBuffer().then((buf) => new Blob([buf], { type: file.type || 'application/octet-stream' }));

      // Ano selecionado / ano do ACT na planilha
      const primaryYear = yearsMap[y]?.length ? y : currentYear;
      const primaryRows = yearsMap[primaryYear] || currentRows;
      await saveYearDataset(primaryYear, primaryRows, {
        fileName: parsed.fileName,
        fileBlob,
        mimeType: file.type || 'application/octet-stream',
        source: 'Relatorio',
        forecast
      });

      // Anos anteriores (PY) embutidos na mesma Relatorio
      const priorYears = [];
      for (const [yearKey, rows] of Object.entries(yearsMap)) {
        const yy = Number(yearKey);
        if (!rows?.length || yy === primaryYear) continue;
        await saveYearDataset(yy, rows, {
          fileName: `${parsed.fileName} · PY ${yy}`,
          source: 'PY Relatorio',
          forecast: 'fc3'
        });
        priorYears.push(yy);
      }

      if (parsed.actions?.length) {
        await Actions.importFromSheet(parsed.actions);
      }

      App.pendingApplyYear = primaryYear;
      Storage.setPreferredYear(primaryYear);
      setAtualizarAppReady(true);

      const slotList = await Storage.listSlots();
      App.availableYears = Storage.listAvailableYears(slotList, seedYear());
      refreshAdminUi(slotList);
      UI.fillUploadYearSelects(yearOptionList(App.availableYears), primaryYear);

      const priorTxt = priorYears.length ? ` · PY ${priorYears.sort().join(', ')} importados` : '';
      const st = parsed.sheetStats;
      const hiddenTxt = st?.hiddenRows
        ? ` · ${st.hiddenRows} linha(s) ocultas/filtradas também lidas`
        : ' · todas as linhas da aba (inclui ocultas)';
      const colTxt = st?.hiddenCols ? ` · ${st.hiddenCols} coluna(s) ocultas lidas` : '';
      msg.textContent = `Planilha salva: ${primaryRows.length} linhas em ${primaryYear}${priorTxt}${hiddenTxt}${colTxt}. Clique em Atualizar app.`;
      UI.showToast('Relatorio enviado. Clique em Atualizar app.');
    } catch (err) {
      console.error(err);
      msg.textContent = err.message || 'Falha ao importar a planilha.';
      UI.showToast('Não foi possível importar. Confira se a aba Relatorio existe.');
      setAtualizarAppReady(false);
    }
  }

  function setAtualizarAppReady(ready) {
    const btn = document.getElementById('btn-atualizar-app');
    if (!btn) return;
    // Sempre clicável após login; "ready" só destaca que há planilha nova
    btn.disabled = !Auth.isLoggedIn();
    btn.classList.toggle('is-ready', Boolean(ready) && Auth.isLoggedIn());
  }

  async function applyUploadedRelatorio() {
    if (!Auth.isLoggedIn()) {
      UI.showToast('Faça login com CWID Bayer.');
      return;
    }
    const msg = document.getElementById('admin-msg');
    const yearSelect = document.getElementById('upload-year-relatorio');
    const year = Number(App.pendingApplyYear)
      || Number(yearSelect?.value)
      || App.selectedYear
      || seedYear();
    msg.textContent = `Atualizando o app com o ano ${year}…`;
    try {
      App.selectedYear = year;
      Storage.setPreferredYear(year);
      await rebuildDataset({ year });
      refreshActions();
      setAtualizarAppReady(false);
      App.pendingApplyYear = null;
      msg.textContent = `App atualizado com os dados de ${year}.`;
      UI.showToast(`App atualizado · ano ${year}.`);
      UI.setTab('detalhes');
    } catch (err) {
      console.error(err);
      msg.textContent = err.message || 'Falha ao atualizar o app.';
      UI.showToast('Não foi possível atualizar o app.');
    }
  }

  const PY_BOOTSTRAP_VERSION = 'yoy-v2';

  async function bootstrapPriorYearsFromCsv() {
    try {
      const done = localStorage.getItem('tsoc_py_bootstrap_v');
      const res = await fetch('data/relatorio.csv', { cache: 'no-store' });
      if (!res.ok) return;
      const text = await res.text();
      const all = Parser.parseCsvAllYears(text);
      const years = Object.entries(all.years || {});
      for (const [yearKey, rows] of years) {
        const yy = Number(yearKey);
        if (!rows?.length) continue;
        if (yy === seedYear()) continue; // seed.json cobre o ano atual
        await saveYearDataset(yy, rows, {
          fileName: `relatorio.csv · PY ${yy}`,
          source: 'PY Relatorio (bootstrap)'
        });
      }
      localStorage.setItem('tsoc_py_bootstrap_v', PY_BOOTSTRAP_VERSION);
      if (done !== PY_BOOTSTRAP_VERSION) {
        console.info(`Bootstrap PY ${PY_BOOTSTRAP_VERSION}:`, years.map(([y, r]) => `${y}:${r.length}`).join(', '));
      }
    } catch (err) {
      console.warn('Bootstrap PY', err);
    }
  }

  async function downloadSlotKey(key) {
    if (!Auth.isLoggedIn()) {
      UI.showToast('Faça login para baixar planilhas.');
      return;
    }
    const info = await Storage.getSlot(key);
    if (info?.fileBlob) {
      const name = info.fileName || (String(key).startsWith('ksb1_') ? `${key}.xlsx` : `${key}.xlsx`);
      Storage.downloadBlob(info.fileBlob, name);
      UI.showToast(`Download de ${name} iniciado.`);
      return;
    }
    if (info?.rows?.length && typeof XLSX !== 'undefined') {
      const isKsb1 = String(key).startsWith('ksb1_') || info.meta?.kind === 'ksb1-month';
      const sheet = XLSX.utils.json_to_sheet(info.rows.map((r) => (isKsb1
        ? {
            Period: r.periodo || r.period || '',
            Ano: r.ano || '',
            Contrato: r.contrato || '',
            Area: r.area || '',
            Fornecedor: r.fornecedorNome || r.fornecedor || '',
            'Centro de custo': r.cc || '',
            Conta: r.conta || '',
            Texto: r.texto || '',
            Valor: r.valor
          }
        : {
            Unidade: r.unidade,
            Setor: r.setor,
            'Centro de custo': r.cc,
            Nome: r.ccNome,
            Tipo: r.tipo,
            Conta: r.conta,
            'Descrição conta': r.contaDesc
          })));
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, isKsb1 ? 'KSB1' : 'Dados');
      const out = XLSX.write(book, { bookType: 'xlsx', type: 'array' });
      const fileName = info.fileName?.endsWith?.('.xlsx') || info.fileName?.endsWith?.('.xls')
        ? info.fileName
        : (info.fileName
          ? `${String(info.fileName).replace(/\.[^.]+$/, '')}.xlsx`
          : (isKsb1 ? `${info.meta?.mesLabel || key}.xlsx` : `tsoc-bfr-${key}.xlsx`));
      Storage.downloadBlob(
        new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        fileName
      );
      UI.showToast('Arquivo gerado a partir dos dados salvos.');
      return;
    }
    UI.showToast('Nenhuma planilha disponível para download neste ano.');
  }

  async function clearKsb1Slot(key) {
    if (!Auth.isLoggedIn()) return;
    const slot = String(key || '');
    if (!Ksb1.parseSlotKey(slot)) return;
    await Storage.clearSlot(slot);
    const monthsNow = await listKsb1MonthSlots();
    await syncKsb1IndexFromSlots(monthsNow);
    await loadKsb1View('all');
    const slotList = await Storage.listSlots();
    refreshAdminUi(slotList);
    const msg = document.getElementById('ksb1-admin-msg');
    if (msg) msg.textContent = `${slot} removido.`;
    UI.showToast('Mês KSB1 removido.');
  }

  async function clearUploadKey(key) {
    if (!Auth.isLoggedIn()) return;
    await Storage.clearSlot(key);
    await rebuildDataset({ year: App.selectedYear });
    document.getElementById('admin-msg').textContent = `${key} removido.`;
  }

  async function clearUploadYear(year) {
    if (!Auth.isLoggedIn()) return;
    const y = Number(year);
    if (!y) return;
    for (const slot of Storage.FORECASTS) {
      await Storage.clearSlot(Storage.slotKey(slot, y));
    }
    await rebuildDataset({ year: App.selectedYear === y ? seedYear() : App.selectedYear });
    document.getElementById('admin-msg').textContent = `Relatorio ${y} removido.`;
    UI.showToast(`Ano ${y} removido do app.`);
  }

  async function restoreSeed() {
    if (!Auth.isLoggedIn()) return;
    // Mantém histórico KSB1 (meses de contratos) ao restaurar o Relatorio/seed
    await Storage.clearAll({ keepKsb1: true });
    App.selectedYear = seedYear();
    Storage.setPreferredYear(App.selectedYear);
    await rebuildDataset({ year: App.selectedYear });
    await loadKsb1FromStorage();
    document.getElementById('admin-msg').textContent = 'Dados iniciais restaurados (histórico KSB1 mantido).';
    UI.showToast('Seed FC3 restaurado · histórico de contratos preservado.');
  }

  function bindEvents() {
    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => UI.setTab(btn.dataset.tab));
    });
    document.querySelectorAll('[data-goto]').forEach((btn) => {
      btn.addEventListener('click', () => UI.setTab(btn.dataset.goto));
    });

    const filterIds = [
      'filtro-unidade', 'filtro-setor', 'filtro-cenario',
      'filtro-periodo', 'filtro-mes', 'filtro-categoria', 'filtro-busca'
    ];
    filterIds.forEach((id) => {
      const el = document.getElementById(id);
      const evt = id === 'filtro-busca' ? 'input' : 'change';
      el.addEventListener(evt, () => {
        if (id === 'filtro-unidade') UI.updateSetorOptions(App.meta);
        UI.state.rankingLimit = 10;
        refreshDetails();
      });
    });

    document.getElementById('filtro-ano').addEventListener('change', (e) => {
      switchYear(e.target.value);
    });

    document.getElementById('btn-limpar-filtros').addEventListener('click', () => {
      UI.clearFilters();
      UI.updateSetorOptions(App.meta);
      UI.state.rankingLimit = 10;
      refreshDetails();
    });

    const prefsBtn = document.getElementById('btn-filter-prefs');
    const prefsPanel = document.getElementById('filter-prefs-panel');
    prefsBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = Boolean(prefsPanel?.hidden);
      if (open) UI.syncFilterPrefsPanel(App.meta.tipos, UI.loadFilterPrefs());
      UI.setFilterPrefsOpen(open);
    });
    document.getElementById('btn-filter-prefs-apply')?.addEventListener('click', () => {
      const prefs = UI.readFilterPrefsFromPanel();
      UI.saveFilterPrefs(prefs);
      UI.applyFilterPrefs(App.meta, prefs);
      UI.updateSetorOptions(App.meta);
      UI.setFilterPrefsOpen(false);
      UI.state.rankingLimit = 10;
      refreshDetails();
      UI.showToast('Filtros da área salvos neste navegador.');
    });
    document.getElementById('btn-filter-prefs-reset')?.addEventListener('click', () => {
      const prefs = UI.defaultFilterPrefs();
      UI.saveFilterPrefs(prefs);
      UI.syncFilterPrefsPanel(App.meta.tipos, prefs);
      UI.applyFilterPrefs(App.meta, prefs);
      UI.updateSetorOptions(App.meta);
      UI.state.rankingLimit = 10;
      refreshDetails();
      UI.showToast('Personalização restaurada ao padrão.');
    });
    document.addEventListener('click', (e) => {
      if (!prefsPanel || prefsPanel.hidden) return;
      if (e.target.closest('.filter-prefs')) return;
      UI.setFilterPrefsOpen(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') UI.setFilterPrefsOpen(false);
    });

    document.getElementById('btn-export-csv').addEventListener('click', exportCsv);
    document.getElementById('btn-download-detalhes-csv').addEventListener('click', exportCsv);
    document.getElementById('btn-download-detalhes-xlsx').addEventListener('click', exportXlsx);
    document.getElementById('btn-salvar-historico').addEventListener('click', () => saveCurrentHistory());
    document.getElementById('filtro-historico').addEventListener('change', (e) => {
      restoreHistory(e.target.value);
    });

    document.getElementById('btn-ver-todos').addEventListener('click', () => {
      const filters = UI.readFilters();
      const sectorList = Engine.aggregateSectors(Engine.aggregateCostCenters(App.rows, filters));
      if (UI.state.rankingLimit < sectorList.length) UI.state.rankingLimit = sectorList.length;
      else UI.state.rankingLimit = 10;
      UI.renderRanking(sectorList);
    });

    document.getElementById('tbody-ranking').addEventListener('click', (e) => {
      const openBtn = e.target.closest('[data-open-setor], [data-open-cc], tr.rank-row');
      if (!openBtn) return;
      const row = openBtn.closest('tr') || openBtn;
      const unidade = openBtn.dataset.unidade || row.dataset.unidade;
      const setor = openBtn.dataset.setor || row.dataset.setor;
      if (openBtn.dataset.openSetor || row.dataset.level === 'setor' || (!openBtn.dataset.openCc && !row.dataset.cc)) {
        if (setor) openSetor(unidade, setor);
        return;
      }
      const cc = openBtn.dataset.openCc || row.dataset.cc;
      if (cc) openCc(cc, unidade, setor);
    });

    document.getElementById('btn-fechar-drawer').addEventListener('click', UI.closeDrawer);
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const panel = document.getElementById('copilot-panel');
      if (panel && !panel.hidden) {
        setCopilotOpen(false);
        return;
      }
      UI.closeDrawer();
    });

    document.getElementById('form-admin-login').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('input-cwid');
      const err = document.getElementById('auth-error');
      const result = Auth.login(input.value);
      if (!result.ok) {
        err.hidden = false;
        err.textContent = result.message;
        return;
      }
      err.hidden = true;
      err.textContent = '';
      showAdminForSession();
      const welcome = result.session.nome
        ? `${result.session.nome} (${result.session.cwid})`
        : result.session.cwid;
      UI.showToast(`Bem-vindo(a), ${welcome}.`);
    });

    const doAdminLogout = async () => {
      Auth.logout();
      if (window.SupaAuth?.isConfigured?.()) {
        await SupaAuth.signOut();
      }
      showAdminForSession();
      UI.showToast('Sessão encerrada.');
    };
    document.getElementById('btn-admin-logout')?.addEventListener('click', () => { doAdminLogout(); });
    document.getElementById('btn-sidebar-logout')?.addEventListener('click', () => { doAdminLogout(); });

    document.getElementById('btn-publish-shared')?.addEventListener('click', () => {
      publishSharedPack();
    });
    document.getElementById('file-import-shared')?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      importSharedPackFile(file);
      e.target.value = '';
    });

    document.getElementById('form-add-cwid').addEventListener('submit', (e) => {
      e.preventDefault();
      if (!Auth.isLoggedIn()) return;
      const input = document.getElementById('input-novo-cwid');
      const nomeInput = document.getElementById('input-novo-nome');
      try {
        Auth.addPerson(input.value, nomeInput?.value || '');
        input.value = '';
        if (nomeInput) nomeInput.value = '';
        refreshAuthLists();
        UI.showToast('Pessoa incluída com acesso ao Administrador.');
      } catch (err) {
        UI.showToast(err.message || 'Não foi possível incluir.');
      }
    });

    document.getElementById('lista-cwids').addEventListener('click', (e) => {
      if (!Auth.isLoggedIn()) return;
      const removeBtn = e.target.closest('[data-remove-cwid]');
      if (removeBtn) {
        try {
          Auth.excludePerson(removeBtn.dataset.removeCwid);
          refreshAuthLists();
          UI.showToast('Acesso excluído / suspenso.');
        } catch (err) {
          UI.showToast(err.message || 'Não foi possível excluir.');
        }
        return;
      }
      const restoreBtn = e.target.closest('[data-restore-cwid]');
      if (restoreBtn) {
        Auth.restorePerson(restoreBtn.dataset.restoreCwid);
        refreshAuthLists();
        UI.showToast('Acesso reativado.');
      }
    });

    ['filtro-acao-mes', 'filtro-acao-status'].forEach((id) => {
      document.getElementById(id)?.addEventListener('change', refreshActions);
    });
    ['filtro-acao-setor', 'filtro-acao-quem'].forEach((id) => {
      document.getElementById(id)?.addEventListener('input', refreshActions);
    });

    document.getElementById('tbody-acoes')?.addEventListener('click', async (e) => {
      const removeQuem = e.target.closest('[data-remove-quem]');
      if (removeQuem) {
        if (!Auth.isLoggedIn()) return;
        try {
          await Actions.removePersonFromAction(removeQuem.dataset.removeQuem, removeQuem.dataset.nome, Auth.getSession());
          refreshActions();
          refreshAuthLists();
          UI.showToast('Pessoa excluída da ação.');
        } catch (err) {
          UI.showToast(err.message || 'Não foi possível excluir.');
        }
        return;
      }
      const excludePessoa = e.target.closest('[data-exclude-pessoa-acao]');
      if (excludePessoa) {
        if (!Auth.isLoggedIn()) return;
        try {
          await Actions.excludePerson(excludePessoa.dataset.excludePessoaAcao, Auth.getSession());
          refreshAuthLists();
          refreshActions();
          UI.showToast('Pessoa excluída.');
        } catch (err) {
          UI.showToast(err.message || 'Não foi possível excluir.');
        }
        return;
      }
      const toggle = e.target.closest('[data-toggle-acao]');
      if (toggle) {
        if (!Auth.isLoggedIn()) return;
        await Actions.toggleConcluido(toggle.dataset.toggleAcao);
        refreshActions();
        return;
      }
      const del = e.target.closest('[data-delete-acao]');
      if (del) {
        if (!Auth.isLoggedIn()) return;
        try {
          await Actions.deleteAction(del.dataset.deleteAcao, Auth.getSession());
          refreshActions();
          UI.showToast('Ação excluída.');
        } catch (err) {
          UI.showToast(err.message || 'Não foi possível excluir a ação.');
        }
        return;
      }
      const addQuem = e.target.closest('[data-add-quem-acao]');
      if (addQuem) {
        if (!Auth.isLoggedIn()) return;
        const nome = window.prompt('Nome da pessoa para incluir nesta ação:');
        if (!nome) return;
        try {
          await Actions.addPersonToAction(addQuem.dataset.addQuemAcao, nome, Auth.getSession());
          refreshActions();
          refreshAuthLists();
          UI.showToast('Pessoa incluída na ação.');
        } catch (err) {
          UI.showToast(err.message || 'Não foi possível incluir.');
        }
      }
    });

    document.getElementById('pessoas-acoes-resumo')?.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-exclude-pessoa-acao]');
      if (!btn || !Auth.isLoggedIn()) return;
      try {
        await Actions.excludePerson(btn.dataset.excludePessoaAcao, Auth.getSession());
        refreshAuthLists();
        refreshActions();
        UI.showToast('Pessoa excluída.');
      } catch (err) {
        UI.showToast(err.message || 'Não foi possível excluir.');
      }
    });

    async function submitNovaAcao(mesId, setorId, comentarioId, quemId, prazoId, formId) {
      if (!Auth.isLoggedIn()) {
        UI.showToast('Entre no Administrador para incluir ações.');
        return;
      }
      const mes = document.getElementById(mesId).value;
      const mesNumero = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8 }[mes] || null;
      await Actions.createAction({
        mes,
        mesNumero,
        setor: document.getElementById(setorId).value,
        comentario: document.getElementById(comentarioId).value,
        quem: document.getElementById(quemId).value,
        prazo: document.getElementById(prazoId).value
      }, Auth.getSession());
      document.getElementById(formId).reset();
      if (document.getElementById(mesId)) document.getElementById(mesId).value = 'ago';
      refreshActions();
      refreshAuthLists();
      UI.showToast('Ação incluída no app.');
    }

    document.getElementById('form-add-pessoa-acao')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!Auth.isLoggedIn()) return;
      const input = document.getElementById('input-pessoa-acao');
      try {
        await Actions.addPerson(input.value, Auth.getSession());
        input.value = '';
        refreshAuthLists();
        refreshActions();
        UI.showToast('Pessoa incluída.');
      } catch (err) {
        UI.showToast(err.message || 'Não foi possível incluir.');
      }
    });

    document.getElementById('form-add-pessoa-acao-detalhes')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!Auth.isLoggedIn()) return;
      const input = document.getElementById('input-pessoa-acao-detalhes');
      try {
        await Actions.addPerson(input.value, Auth.getSession());
        input.value = '';
        refreshAuthLists();
        refreshActions();
        UI.showToast('Pessoa incluída no app.');
      } catch (err) {
        UI.showToast(err.message || 'Não foi possível incluir.');
      }
    });

    document.getElementById('lista-pessoas-incluidas')?.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-exclude-pessoa-acao]');
      if (!btn || !Auth.isLoggedIn()) return;
      try {
        await Actions.excludePerson(btn.dataset.excludePessoaAcao, Auth.getSession());
        refreshAuthLists();
        refreshActions();
        UI.showToast('Pessoa excluída.');
      } catch (err) {
        UI.showToast(err.message || 'Não foi possível excluir.');
      }
    });

    document.getElementById('form-nova-acao')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await submitNovaAcao(
          'input-acao-mes',
          'input-acao-setor',
          'input-acao-comentario',
          'input-acao-quem',
          'input-acao-prazo',
          'form-nova-acao'
        );
      } catch (err) {
        UI.showToast(err.message || 'Não foi possível criar a ação.');
      }
    });

    document.getElementById('form-nova-acao-detalhes')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await submitNovaAcao(
          'input-acao-mes-detalhes',
          'input-acao-setor-detalhes',
          'input-acao-comentario-detalhes',
          'input-acao-quem-detalhes',
          'input-acao-prazo-detalhes',
          'form-nova-acao-detalhes'
        );
      } catch (err) {
        UI.showToast(err.message || 'Não foi possível criar a ação.');
      }
    });

    document.querySelectorAll('[data-upload]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!Auth.isLoggedIn()) {
          UI.showToast('Faça login com CWID Bayer.');
          return;
        }
        const input = document.getElementById(`file-${btn.dataset.upload}`)
          || document.getElementById('file-relatorio');
        input?.click();
      });
    });

    const relatorioInput = document.getElementById('file-relatorio');
    if (relatorioInput) {
      relatorioInput.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        const yearSelect = document.getElementById('upload-year-relatorio')
          || document.querySelector('[data-upload-year]');
        const year = Number(yearSelect?.value) || App.selectedYear || seedYear();
        // Um Relatorio alimenta todos os cenários (Budget/FC1–FC3)
        await handleUpload('fc3', file, year);
      });
    }

    document.getElementById('upload-grid')?.addEventListener('click', (e) => {
      const dl = e.target.closest('[data-download-key]');
      if (dl) {
        downloadSlotKey(dl.dataset.downloadKey);
        return;
      }
      const rmKsb1 = e.target.closest('[data-clear-ksb1]');
      if (rmKsb1) {
        clearKsb1Slot(rmKsb1.dataset.clearKsb1);
        return;
      }
      const rmYear = e.target.closest('[data-clear-year]');
      if (rmYear) {
        clearUploadYear(rmYear.dataset.clearYear);
        return;
      }
      const rm = e.target.closest('[data-clear-key]');
      if (rm) clearUploadKey(rm.dataset.clearKey);
    });

    document.getElementById('btn-restaurar-seed')?.addEventListener('click', restoreSeed);
    document.getElementById('btn-atualizar-app')?.addEventListener('click', () => {
      applyUploadedRelatorio();
    });

    bindCopilot();
  }

  function formatCopilotHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }

  function appendCopilotMessage(role, text) {
    const box = document.getElementById('copilot-messages');
    const el = document.createElement('div');
    el.className = `copilot-msg ${role}`;
    el.innerHTML = formatCopilotHtml(text);
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
  }

  function setCopilotOpen(open) {
    const panel = document.getElementById('copilot-panel');
    const btn = document.getElementById('btn-copilot-toggle');
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      const input = document.getElementById('copilot-input');
      input.focus();
    }
  }

  function askCopilot(question) {
    const q = String(question || '').trim();
    if (!q) return;
    appendCopilotMessage('user', q);
    let answer;
    try {
      answer = CopilotAgent.answer(q);
    } catch (err) {
      console.error(err);
      answer = 'Não consegui responder agora. Tente de novo com outra formulação (ex.: “resumo atual”).';
    }
    appendCopilotMessage('bot', answer || 'Sem resposta.');
    document.getElementById('copilot-input').value = '';
  }

  function bindCopilot() {
    CopilotAgent.setContextProvider(() => ({
      rows: App.rows,
      filters: UI.readFilters(),
      meta: App.meta,
      year: App.selectedYear || seedYear()
    }));

    const messages = document.getElementById('copilot-messages');
    if (!messages.dataset.seeded) {
      messages.dataset.seeded = '1';
      appendCopilotMessage(
        'bot',
        'Olá! Sou o **ajudante do TSOC BFR**.\n\nPosso explicar o que tem no app (abas, filtros, termos) e responder com os números do recorte atual.\n\nExemplos: “quais abas existem?”, “como filtrar?”, “resumo atual”, “centros acima do previsto” ou um CC (MW…). Digite **ajuda** para a lista completa.'
      );
    }

    document.getElementById('btn-copilot-toggle').addEventListener('click', () => {
      const panel = document.getElementById('copilot-panel');
      setCopilotOpen(panel.hidden);
    });
    document.getElementById('btn-copilot-close').addEventListener('click', () => setCopilotOpen(false));

    document.getElementById('copilot-form').addEventListener('submit', (e) => {
      e.preventDefault();
      askCopilot(document.getElementById('copilot-input').value);
    });

    document.getElementById('copilot-suggestions').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-q]');
      if (!btn) return;
      setCopilotOpen(true);
      askCopilot(btn.dataset.q);
    });

    document.getElementById('btn-upload-ksb1')?.addEventListener('click', () => {
      document.getElementById('file-ksb1')?.click();
    });
    document.getElementById('file-ksb1')?.addEventListener('change', async (e) => {
      const files = [...(e.target.files || [])];
      e.target.value = '';
      if (!files.length) return;
      try {
        await stageKsb1Files(files);
      } catch (err) {
        console.error(err);
        UI.showToast(err.message || 'Falha ao ler a KSB1.');
      }
    });
    document.getElementById('btn-atualizar-ksb1')?.addEventListener('click', async () => {
      try {
        await applyKsb1Pending();
      } catch (err) {
        console.error(err);
        UI.showToast(err.message || 'Falha ao atualizar os contratos.');
      }
    });
    document.getElementById('btn-limpar-ksb1')?.addEventListener('click', async () => {
      try {
        await clearKsb1Month();
      } catch (err) {
        console.error(err);
        UI.showToast(err.message || 'Falha ao remover o mês.');
      }
    });
    document.getElementById('filtro-ksb1-mes')?.addEventListener('change', async (e) => {
      try {
        await loadKsb1View(e.target.value || 'all');
      } catch (err) {
        console.error(err);
        UI.showToast('Não foi possível trocar o mês da KSB1.');
      }
    });
    document.getElementById('ksb1-history-list')?.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-ksb1-month]');
      if (!btn) return;
      try {
        await loadKsb1View(btn.dataset.ksb1Month || 'all');
      } catch (err) {
        console.error(err);
        UI.showToast('Não foi possível abrir este mês do histórico.');
      }
    });
    document.getElementById('ksb1-month-gap-strip')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-ksb1-month-gap]');
      if (!btn) return;
      UI.state.ksb1MonthGapKey = btn.dataset.ksb1MonthGap || null;
      refreshContratos();
    });
    document.getElementById('ksb1-month-gap-detail')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-ksb1-contrato]');
      if (!btn) return;
      openKsb1ContratoDetail(btn.dataset.ksb1Contrato);
    });
    document.getElementById('ksb1-gap-filter')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-ksb1-gap-filter]');
      if (!btn) return;
      UI.state.ksb1GapStatusFilter = btn.dataset.ksb1GapFilter || 'all';
      refreshContratos();
    });
    document.getElementById('tbody-ksb1-gap')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-ksb1-contrato]');
      if (!btn) return;
      e.preventDefault();
      openKsb1ContratoDetail(btn.dataset.ksb1Contrato);
    });
    document.getElementById('tbody-ksb1-gap')?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const row = e.target.closest('tr[data-ksb1-contrato]');
      if (!row) return;
      e.preventDefault();
      openKsb1ContratoDetail(row.dataset.ksb1Contrato);
    });
    document.getElementById('kpi-ksb1-gap')?.addEventListener('click', () => {
      const byMonth = App.ksb1LastAnalysis?.byMonth || [];
      const focus = byMonth.find((m) => m.gaps > 0 && m.isLast)
        || byMonth.find((m) => m.gaps > 0)
        || byMonth[byMonth.length - 1];
      if (focus) UI.state.ksb1MonthGapKey = focus.key;
      refreshContratos();
      const card = document.getElementById('ksb1-month-gaps');
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else UI.showToast('Nenhum gap no histórico.');
    });
    ['filtro-ksb1-area', 'filtro-ksb1-contrato', 'filtro-ksb1-cc'].forEach((id) => {
      document.getElementById(id)?.addEventListener('change', () => {
        if (id === 'filtro-ksb1-cc') App.ksb1CcScope = null;
        refreshContratos();
      });
    });
    ['filtro-ksb1-fornecedor', 'filtro-ksb1-busca'].forEach((id) => {
      document.getElementById(id)?.addEventListener('input', refreshContratos);
    });
    document.getElementById('btn-limpar-filtros-ksb1')?.addEventListener('click', () => {
      ['filtro-ksb1-area', 'filtro-ksb1-contrato', 'filtro-ksb1-cc'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      const forn = document.getElementById('filtro-ksb1-fornecedor');
      const busca = document.getElementById('filtro-ksb1-busca');
      if (forn) forn.value = '';
      if (busca) busca.value = '';
      App.ksb1CcScope = null;
      UI.state.ksb1GapStatusFilter = 'all';
      refreshContratos();
    });
  }

  function warnIfOpenedAsFile() {
    if (location.protocol !== 'file:') return false;
    const hint = document.querySelector('#admin-gate .auth-hint');
    if (hint) {
      hint.innerHTML = 'Você abriu o <code>index.html</code> direto. Feche esta aba e use '
        + '<a href="http://localhost:8080/?v=dash24">http://localhost:8080</a> '
        + '(rode <code>serve.ps1</code> antes). Sem isso o Admin e os dados não carregam.';
    }
    const err = document.getElementById('auth-error');
    if (err) {
      err.hidden = false;
      err.textContent = 'Abra pelo servidor local: http://localhost:8080 — não pelo arquivo.';
    }
    const chip = document.getElementById('chip-fonte');
    if (chip) chip.textContent = 'Abra via localhost:8080 (não use o arquivo)';
    UI.showToast('Abra http://localhost:8080 — não o index.html pelo Explorer.');
    return true;
  }

  async function init() {
    bindEvents();
    UI.setTab('inicio');
    UI.placeFilters();
    const asFile = warnIfOpenedAsFile();
    await Auth.loadAuthorized();

    // Acesso web real via Supabase (e-mails autorizados)
    if (window.SupaAuth && !asFile) {
      const access = await SupaAuth.init();
      if (SupaAuth.isConfigured() && !access?.ok && !access?.skipped) {
        // Aguarda login; quando autenticar, recarrega o restante
        document.addEventListener('tsoc:auth', async () => {
          showAdminForSession();
          try {
            await bootAppData();
          } catch (err) {
            console.error(err);
            UI.showToast('Falha ao carregar a base após login.');
          }
        }, { once: true });
        showAdminForSession();
        return;
      }
    }

    showAdminForSession();
    if (asFile) return;
    try {
      await bootAppData();
    } catch (err) {
      console.error(err);
      document.getElementById('chip-fonte').textContent = 'Erro ao carregar dados';
      UI.showToast('Falha ao carregar a base inicial.');
    }
  }

  async function bootAppData() {
    await loadSeed();
    App.selectedYear = Storage.getPreferredYear(seedYear());
    await Storage.migrateLegacySlots(seedYear());
    await Actions.loadSeed();
    await Actions.loadLocal();
    await bootstrapPriorYearsFromCsv();
    setYearLabels(App.selectedYear);
    UI.populateYearFilter(yearOptionList(), App.selectedYear);
    UI.fillUploadYearSelects(yearOptionList(), App.selectedYear);
    await refreshHistorySelect();
    await rebuildDataset({ persist: true, year: App.selectedYear });
    await loadKsb1FromStorage();
    await syncSharedPackFromRepo();
    refreshActions();
    refreshAuthLists();
    refreshSharedPublishMsg();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
