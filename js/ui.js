/* Renderização da UI: filtros, KPIs, árvore, ranking e drawer */
const UI = (() => {
  const state = {
    expandedUnits: new Set(),
    expandedSectors: new Set(),
    rankingLimit: 10,
    chart: null,
    overviewChart: null,
    chartSeries: null,
    chartFilters: null,
    chartMode: 'auto',
    selectedCcKey: null,
    metaTipos: [],
    ksb1MonthGapKey: null,
    ksb1GapStatusFilter: 'all'
  };

  function $(sel, root = document) {
    return root.querySelector(sel);
  }

  function showToast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { el.hidden = true; }, 3200);
  }

  function placeFilters(tab) {
    const filtros = $('#filtros');
    if (!filtros) return;
    const hostInicio = $('#filtros-host-inicio');
    const hostDetalhes = $('#filtros-host-detalhes');
    if (tab === 'detalhes' && hostDetalhes) {
      hostDetalhes.appendChild(filtros);
    } else if (hostInicio) {
      hostInicio.appendChild(filtros);
    }
  }

  function setTab(tab) {
    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.tab === tab);
    });
    document.querySelectorAll('.pill-btn[data-goto]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.goto === tab);
    });
    document.querySelectorAll('.tab-panel').forEach((panel) => {
      const active = panel.id === `tab-${tab}`;
      panel.classList.toggle('is-active', active);
      panel.hidden = !active;
    });
    document.body.dataset.tab = tab;
    placeFilters(tab);
    if (tab === 'admin' && typeof window.onAdminTabShow === 'function') {
      window.onAdminTabShow();
    }
  }

  function fillSelect(select, values, { placeholder, keepValue = true } = {}) {
    const current = keepValue ? select.value : '';
    select.innerHTML = '';
    if (placeholder != null) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = placeholder;
      select.appendChild(opt);
    }
    values.forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      select.appendChild(opt);
    });
    if (current && values.includes(current)) select.value = current;
  }

  function populateYearFilter(years, selectedYear) {
    const select = $('#filtro-ano');
    if (!select) return;
    const list = (years || []).map(Number).filter(Boolean);
    const unique = [...new Set(list)].sort((a, b) => b - a);
    if (!unique.length) unique.push(2026);
    const current = Number(selectedYear) || Number(select.value) || unique[0];
    select.innerHTML = unique.map((y) => `<option value="${y}">${y}</option>`).join('');
    select.value = unique.includes(current) ? String(current) : String(unique[0]);
  }

  function syncYearModeUi(mode, year) {
    const cenario = $('#filtro-cenario');
    const banner = $('#py-year-banner');
    const pageSub = document.querySelector('#tab-detalhes .page-sub');
    if (cenario) {
      if (mode === 'yoy') {
        [...cenario.options].forEach((opt) => {
          opt.textContent = `Ano anterior (${Number(year) - 1})`;
        });
        cenario.value = 'fc2';
        cenario.disabled = true;
      } else if (mode === 'py-only') {
        [...cenario.options].forEach((opt) => {
          opt.textContent = 'Sem base de comparação';
        });
        cenario.disabled = true;
      } else {
        const labels = { budget: 'Budget', fc1: 'FC1', fc2: 'FC2', fc3: 'FC3' };
        [...cenario.options].forEach((opt) => {
          opt.textContent = labels[opt.value] || opt.value;
        });
        cenario.disabled = false;
      }
    }
    if (pageSub) {
      if (mode === 'yoy') {
        pageSub.innerHTML = `Ano <strong id="label-ano">${year}</strong> · PY da Relatorio · Realizado ${year} versus <strong>${Number(year) - 1}</strong> · Valores em milhares (k)`;
      } else if (mode === 'py-only') {
        pageSub.innerHTML = `Ano <strong id="label-ano">${year}</strong> · PY da Relatorio (somente realizado) · Valores em milhares (k)`;
      } else {
        pageSub.innerHTML = `Ano <strong id="label-ano">${year}</strong> · Valores em milhares (k) · Realizado versus cenário selecionado`;
      }
    }
    if (banner) {
      if (mode === 'yoy') {
        banner.hidden = false;
        banner.textContent = `Ano histórico ${year}: realizado = coluna PY ${year}; previsto = PY ${Number(year) - 1} (comparação ano a ano).`;
      } else if (mode === 'py-only') {
        banner.hidden = false;
        banner.textContent = `Ano histórico ${year}: exibindo só o realizado PY. Não há ano anterior na planilha para comparar.`;
      } else {
        banner.hidden = true;
        banner.textContent = '';
      }
    }
  }

  function fillUploadYearSelects(years, selectedYear) {
    const list = (years || []).map(Number).filter(Boolean);
    const unique = [...new Set(list)].sort((a, b) => b - a);
    if (!unique.length) unique.push(2026);
    const pick = Number(selectedYear) || unique[0];
    document.querySelectorAll('[data-upload-year]').forEach((select) => {
      const keep = Number(select.value) || pick;
      select.innerHTML = unique.map((y) => `<option value="${y}">${y}</option>`).join('');
      select.value = unique.includes(keep) ? String(keep) : String(unique[0]);
    });
  }

  const FILTER_PREFS_KEY = 'tsoc_filter_prefs_v1';
  const OPTIONAL_FILTER_FIELDS = ['unidade', 'setor', 'categoria', 'busca'];

  function defaultFilterPrefs() {
    return {
      fields: { unidade: true, setor: true, categoria: true, busca: true },
      hidePessoas: false,
      onlyTipos: []
    };
  }

  function loadFilterPrefs() {
    try {
      const raw = localStorage.getItem(FILTER_PREFS_KEY);
      if (!raw) return defaultFilterPrefs();
      const parsed = JSON.parse(raw);
      const base = defaultFilterPrefs();
      return {
        fields: { ...base.fields, ...(parsed.fields || {}) },
        hidePessoas: Boolean(parsed.hidePessoas),
        onlyTipos: Array.isArray(parsed.onlyTipos) ? parsed.onlyTipos.filter(Boolean) : []
      };
    } catch {
      return defaultFilterPrefs();
    }
  }

  function saveFilterPrefs(prefs) {
    localStorage.setItem(FILTER_PREFS_KEY, JSON.stringify(prefs));
  }

  function visibleTipos(metaTipos, prefs) {
    const prefsSafe = prefs || loadFilterPrefs();
    let list = (metaTipos || []).slice();
    if (prefsSafe.hidePessoas) list = list.filter((t) => !Engine.isTipoPessoas(t));
    if (prefsSafe.onlyTipos?.length) {
      const allow = new Set(prefsSafe.onlyTipos);
      list = list.filter((t) => allow.has(t));
    }
    return list;
  }

  function excludeTiposFromPrefs(prefs, metaTipos) {
    const prefsSafe = prefs || loadFilterPrefs();
    const all = metaTipos || [];
    const exclude = new Set();
    if (prefsSafe.hidePessoas) {
      all.forEach((t) => { if (Engine.isTipoPessoas(t)) exclude.add(t); });
    }
    if (prefsSafe.onlyTipos?.length) {
      const allow = new Set(prefsSafe.onlyTipos);
      all.forEach((t) => { if (!allow.has(t)) exclude.add(t); });
    }
    return [...exclude];
  }

  function applyFilterFieldVisibility(prefs) {
    const prefsSafe = prefs || loadFilterPrefs();
    OPTIONAL_FILTER_FIELDS.forEach((key) => {
      const el = document.querySelector(`[data-filter-field="${key}"]`);
      if (!el) return;
      const on = prefsSafe.fields?.[key] !== false;
      el.hidden = !on;
      if (!on) {
        if (key === 'unidade') {
          const u = $('#filtro-unidade');
          if (u) u.value = '';
          const s = $('#filtro-setor');
          if (s) {
            s.innerHTML = '<option value="">Todos</option>';
            s.disabled = true;
            s.value = '';
          }
        }
        if (key === 'setor') {
          const s = $('#filtro-setor');
          if (s) s.value = '';
        }
        if (key === 'categoria') {
          const c = $('#filtro-categoria');
          if (c) c.value = '';
        }
        if (key === 'busca') {
          const b = $('#filtro-busca');
          if (b) b.value = '';
        }
      }
    });
  }

  function syncFilterPrefsChip(prefs) {
    const chip = $('#filter-prefs-chip');
    if (!chip) return;
    const prefsSafe = prefs || loadFilterPrefs();
    const parts = [];
    if (prefsSafe.hidePessoas) parts.push('Sem pessoas');
    if (prefsSafe.onlyTipos?.length) parts.push(`${prefsSafe.onlyTipos.length} categorias`);
    const hiddenFields = OPTIONAL_FILTER_FIELDS.filter((k) => prefsSafe.fields?.[k] === false);
    if (hiddenFields.length) parts.push(`${hiddenFields.length} campo(s) oculto(s)`);
    if (!parts.length) {
      chip.hidden = true;
      chip.textContent = '';
      return;
    }
    chip.hidden = false;
    chip.textContent = parts.join(' · ');
  }

  function renderFilterPrefsTipos(metaTipos, prefs) {
    const box = $('#filter-prefs-tipos');
    if (!box) return;
    const prefsSafe = prefs || loadFilterPrefs();
    const selected = new Set(prefsSafe.onlyTipos || []);
    const tipos = (metaTipos || []).slice().sort((a, b) => a.localeCompare(b, 'pt-BR'));
    if (!tipos.length) {
      box.innerHTML = '<p class="filter-prefs-empty">Carregue os dados para listar categorias.</p>';
      return;
    }
    box.innerHTML = tipos.map((t) => {
      const people = Engine.isTipoPessoas(t);
      return `<label class="${people ? 'is-pessoas' : ''}">
        <input type="checkbox" data-pref-tipo="${escapeHtml(t)}" ${selected.has(t) ? 'checked' : ''}>
        <span>${escapeHtml(t)}${people ? ' <em>pessoas</em>' : ''}</span>
      </label>`;
    }).join('');
  }

  function syncFilterPrefsPanel(metaTipos, prefs) {
    const prefsSafe = prefs || loadFilterPrefs();
    OPTIONAL_FILTER_FIELDS.forEach((key) => {
      const input = document.querySelector(`[data-pref-field="${key}"]`);
      if (input) input.checked = prefsSafe.fields?.[key] !== false;
    });
    const hide = $('#pref-hide-pessoas');
    if (hide) hide.checked = Boolean(prefsSafe.hidePessoas);
    renderFilterPrefsTipos(metaTipos, prefsSafe);
    syncFilterPrefsChip(prefsSafe);
  }

  function readFilterPrefsFromPanel() {
    const fields = {};
    OPTIONAL_FILTER_FIELDS.forEach((key) => {
      const input = document.querySelector(`[data-pref-field="${key}"]`);
      fields[key] = input ? input.checked : true;
    });
    const onlyTipos = [...document.querySelectorAll('#filter-prefs-tipos [data-pref-tipo]:checked')]
      .map((el) => el.getAttribute('data-pref-tipo'))
      .filter(Boolean);
    return {
      fields,
      hidePessoas: Boolean($('#pref-hide-pessoas')?.checked),
      onlyTipos
    };
  }

  function setFilterPrefsOpen(open) {
    const panel = $('#filter-prefs-panel');
    const btn = $('#btn-filter-prefs');
    if (!panel || !btn) return;
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function applyFilterPrefs(meta, prefs) {
    const prefsSafe = prefs || loadFilterPrefs();
    applyFilterFieldVisibility(prefsSafe);
    const keepCat = $('#filtro-categoria')?.value || '';
    const tipos = visibleTipos(meta?.tipos || [], prefsSafe);
    fillSelect($('#filtro-categoria'), tipos, { placeholder: 'Todas' });
    if (keepCat && tipos.includes(keepCat)) $('#filtro-categoria').value = keepCat;
    syncFilterPrefsChip(prefsSafe);
    return prefsSafe;
  }

  function populateFilters(meta) {
    state.metaTipos = meta?.tipos || [];
    fillSelect($('#filtro-unidade'), meta.unidades, { placeholder: 'Todas' });
    const prefs = loadFilterPrefs();
    fillSelect($('#filtro-categoria'), visibleTipos(meta.tipos, prefs), { placeholder: 'Todas' });
    updateSetorOptions(meta);
    applyFilterFieldVisibility(prefs);
    syncFilterPrefsPanel(meta.tipos, prefs);
  }

  function updateSetorOptions(meta) {
    const unidade = $('#filtro-unidade').value;
    const setorSelect = $('#filtro-setor');
    if (!unidade) {
      setorSelect.innerHTML = '<option value="">Todos</option>';
      setorSelect.disabled = true;
      setorSelect.value = '';
      return;
    }
    const setores = meta.setorMap[unidade] || [];
    fillSelect(setorSelect, setores, { placeholder: 'Todos' });
    setorSelect.disabled = false;
  }

  function readFilters() {
    const prefs = loadFilterPrefs();
    const tipos = state.metaTipos || [];
    const unidadeField = document.querySelector('[data-filter-field="unidade"]');
    const setorField = document.querySelector('[data-filter-field="setor"]');
    const catField = document.querySelector('[data-filter-field="categoria"]');
    const buscaField = document.querySelector('[data-filter-field="busca"]');
    return Engine.getFiltersFromUi({
      unidade: unidadeField?.hidden ? '' : ($('#filtro-unidade')?.value || ''),
      setor: setorField?.hidden ? '' : ($('#filtro-setor')?.value || ''),
      scenario: $('#filtro-cenario').value,
      periodo: $('#filtro-periodo').value,
      mes: $('#filtro-mes').value,
      categoria: catField?.hidden ? '' : ($('#filtro-categoria')?.value || ''),
      busca: buscaField?.hidden ? '' : ($('#filtro-busca')?.value || ''),
      excludeTipos: excludeTiposFromPrefs(prefs, tipos),
      onlyTipos: []
    });
  }

  function clearFilters() {
    $('#filtro-unidade').value = '';
    $('#filtro-setor').innerHTML = '<option value="">Todos</option>';
    $('#filtro-setor').disabled = true;
    $('#filtro-cenario').value = 'fc2';
    $('#filtro-periodo').value = 'ytd';
    $('#filtro-mes').value = 'ago';
    $('#filtro-categoria').value = '';
    $('#filtro-busca').value = '';
  }

  function diffClass(situacaoKey) {
    if (situacaoKey === 'economia') return 'diff-economia';
    if (situacaoKey === 'estouro') return 'diff-estouro';
    return 'diff-estavel';
  }

  function deviationBar(diff, maxAbs) {
    const pct = maxAbs > 0 ? Math.min(100, (Math.abs(diff) / maxAbs) * 100) : 0;
    const label = Engine.formatK(diff, { signed: true });
    const neg = diff < 0
      ? `<div class="devio-fill economia" style="width:${pct}%"></div>`
      : '';
    const pos = diff > 0
      ? `<div class="devio-fill estouro" style="width:${pct}%"></div>`
      : '';
    return `<div class="devio-cell">
      <span class="devio-value ${diffClass(diff > 0 ? 'estouro' : diff < 0 ? 'economia' : 'estavel')}">${label}</span>
      <div class="devio-bar-divergent" title="${label}" role="img" aria-label="Desvio ${label}">
        <div class="devio-half devio-half-neg">${neg}</div>
        <div class="devio-zero" aria-hidden="true"></div>
        <div class="devio-half devio-half-pos">${pos}</div>
      </div>
    </div>`;
  }

  function renderKpis(sum) {
    $('#kpi-ccs').textContent = sum.ccs.toLocaleString('pt-BR');
    $('#kpi-realizado').textContent = Engine.formatK(sum.realizado);
    $('#kpi-previsto').textContent = Engine.formatK(sum.previsto);
    const diffEl = $('#kpi-diff');
    diffEl.textContent = Engine.formatK(sum.diff, { signed: true });
    diffEl.className = `kpi-value ${diffClass(sum.situacao.key)}`;
    $('#kpi-diff-hint').textContent = sum.situacao.label;
    $('#kpi-acima').textContent = sum.acima.toLocaleString('pt-BR');
    $('#resumo-frase').textContent = Engine.naturalSummary(sum);
  }

  function renderHomeSnapshot(rows) {
    const meta = Engine.metaFromRows(rows);
    const filters = readFilters();
    const ccs = Engine.aggregateCostCenters(rows, filters);
    const sum = Engine.summary(ccs, filters);
    $('#snap-unidades').textContent = meta.unidades.length;
    $('#snap-ccs').textContent = sum.ccs;
    $('#snap-realizado').textContent = Engine.formatK(sum.realizado);
    const diffEl = $('#snap-diff');
    diffEl.textContent = Engine.formatK(sum.diff, { signed: true });
    diffEl.className = `diff ${diffClass(sum.situacao.key)}`;

    const mesLabel = Engine.MONTH_LABELS[filters.mes] || filters.mes || '';
    const scenLabel = Engine.SCENARIO_LABELS[filters.scenario] || filters.scenario || 'FC2';
    const realLabel = $('#snap-realizado-label');
    const realHint = $('#snap-realizado-hint');
    const diffLabel = $('#snap-diff-label');
    if (realLabel) {
      realLabel.textContent = filters.periodo === 'mes' ? 'Realizado no mês' : 'Realizado YTD';
    }
    if (realHint) {
      realHint.textContent = filters.periodo === 'mes'
        ? `${mesLabel} · k`
        : `Acumulado até ${mesLabel} · k`;
    }
    if (diffLabel) diffLabel.textContent = `vs ${scenLabel}`;
  }

  function renderTree(tree) {
    const tbody = $('#tbody-unidade');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!tree.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Nenhum centro de custo para os filtros atuais.</td></tr>';
      return;
    }

    const maxAbs = Math.max(...tree.flatMap((u) => [
      Math.abs(u.diff),
      ...u.sectors.flatMap((s) => [Math.abs(s.diff), ...s.ccs.map((c) => Math.abs(c.diff))])
    ]), 1);

    tree.forEach((unit) => {
      const uKey = unit.name;
      const uOpen = state.expandedUnits.has(uKey);
      tbody.appendChild(rowEl({
        level: 'unidade',
        key: uKey,
        open: uOpen,
        name: unit.name,
        previsto: unit.previsto,
        realizado: unit.realizado,
        diff: unit.diff,
        situacao: unit.situacao,
        maxAbs,
        toggle: true
      }));

      unit.sectors.forEach((sector) => {
        const sKey = `${uKey}||${sector.name}`;
        const sOpen = state.expandedSectors.has(sKey);
        const sRow = rowEl({
          level: 'setor',
          key: sKey,
          open: sOpen,
          name: sector.name,
          previsto: sector.previsto,
          realizado: sector.realizado,
          diff: sector.diff,
          situacao: sector.situacao,
          maxAbs,
          toggle: true,
          hidden: !uOpen
        });
        sRow.dataset.parentUnit = uKey;
        tbody.appendChild(sRow);

        sector.ccs.forEach((cc) => {
          const cRow = rowEl({
            level: 'cc',
            key: `${sKey}||${cc.cc}`,
            name: `${cc.cc} — ${cc.ccNome || 'Centro de custo'}`,
            previsto: cc.previsto,
            realizado: cc.realizado,
            diff: cc.diff,
            situacao: cc.situacao,
            maxAbs,
            toggle: false,
            hidden: !uOpen || !sOpen,
            cc
          });
          cRow.dataset.parentUnit = uKey;
          cRow.dataset.parentSector = sKey;
          tbody.appendChild(cRow);
        });
      });
    });
  }

  function rowEl({ level, key, open, name, previsto, realizado, diff, situacao, maxAbs, toggle, hidden, cc }) {
    const tr = document.createElement('tr');
    tr.className = `row-${level}${hidden ? ' row-hidden' : ''}`;
    tr.dataset.key = key;
    if (cc) {
      tr.dataset.cc = cc.cc;
      tr.dataset.unidade = cc.unidade;
      tr.dataset.setor = cc.setor;
    }

    const nameCell = toggle
      ? `<button type="button" class="tree-toggle" data-toggle="${level}" data-key="${key}" aria-expanded="${open ? 'true' : 'false'}"><span class="chev">${open ? '▼' : '▶'}</span>${escapeHtml(name)}</button>`
      : `<button type="button" class="tree-toggle" data-open-cc="${cc.cc}" data-unidade="${escapeHtml(cc.unidade)}" data-setor="${escapeHtml(cc.setor)}">${escapeHtml(name)}</button>`;

    tr.innerHTML = `
      <td>${nameCell}</td>
      <td class="num">${Engine.formatK(previsto)}</td>
      <td class="num">${Engine.formatK(realizado)}</td>
      <td class="num ${diffClass(situacao.key)}">${Engine.formatK(diff, { signed: true })}</td>
      <td class="devio-cell">${deviationBar(diff, maxAbs)}</td>
      <td><span class="badge ${situacao.key}">${situacao.label}</span></td>
    `;
    return tr;
  }

  function renderRanking(ccList, { showAll } = {}) {
    const tbody = $('#tbody-ranking');
    const sorted = Engine.sortAttention(ccList);
    const limit = showAll || state.rankingLimit >= sorted.length ? sorted.length : state.rankingLimit;
    const maxAbs = Math.max(...sorted.map((c) => Math.abs(c.diff)), 1);
    tbody.innerHTML = '';

    if (!sorted.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Sem dados no ranking.</td></tr>';
      $('#btn-ver-todos').hidden = true;
      return;
    }

    sorted.slice(0, limit).forEach((cc, i) => {
      const tr = document.createElement('tr');
      tr.className = 'rank-row';
      tr.dataset.cc = cc.cc;
      tr.dataset.unidade = cc.unidade;
      tr.dataset.setor = cc.setor;
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td><strong>${escapeHtml(cc.cc)}</strong><div style="color:var(--ink-muted);font-size:0.8rem">${escapeHtml(cc.ccNome || '')}</div></td>
        <td>${escapeHtml(cc.unidade)}</td>
        <td>${escapeHtml(cc.setor)}</td>
        <td class="num">${Engine.formatK(cc.realizado)}</td>
        <td class="num">${Engine.formatK(cc.previsto)}</td>
        <td>${deviationBar(cc.diff, maxAbs)}</td>
        <td><button type="button" class="btn btn-ghost btn-sm btn-rank-open" data-open-cc="${cc.cc}" data-unidade="${escapeHtml(cc.unidade)}" data-setor="${escapeHtml(cc.setor)}" aria-label="Abrir detalhe de ${escapeHtml(cc.cc)}">→</button></td>
      `;
      tbody.appendChild(tr);
    });

    const btn = $('#btn-ver-todos');
    if (sorted.length > 10) {
      btn.hidden = false;
      btn.textContent = state.rankingLimit >= sorted.length ? 'Ver top 10' : 'Ver todos';
    } else {
      btn.hidden = true;
    }
  }

  function openDrawer(ccDetail, filters) {
    const accounts = Engine.accountImpact(ccDetail, filters);
    const comments = Engine.commentsByTipo(ccDetail, filters);
    const series = Engine.monthlySeries(ccDetail, filters);
    const scenarioLabel = Engine.SCENARIO_LABELS[filters.scenario];
    const year = document.getElementById('label-ano')?.textContent || '2026';

    const situacaoTag = ccDetail.situacao.key === 'estouro'
      ? 'tag-gap'
      : ccDetail.situacao.key === 'economia'
        ? 'tag-real'
        : 'tag-plan';
    setDrawerChrome({
      kicker: 'Centro de custo · visão completa',
      title: `${ccDetail.cc} — ${ccDetail.ccNome || 'Centro de custo'}`,
      meta: `${ccDetail.unidade} · ${ccDetail.setor} · Ano ${year}`,
      backLabel: '← Voltar ao ranking',
      tagsHtml: `
        <span class="tag tag-real">REAL</span>
        <span class="tag tag-plan">${escapeHtml(scenarioLabel)}</span>
        <span class="tag ${situacaoTag}">${escapeHtml(ccDetail.situacao.label)}</span>
      `
    });

    const commentsHtml = comments.length
      ? comments.slice(0, 30).map((c) => `
          <tr>
            <td>${escapeHtml(c.tipo)}</td>
            <td>${escapeHtml(c.comentario)}</td>
            <td class="num">${Engine.formatK(c.previsto)}</td>
            <td class="num">${Engine.formatK(c.realizado)}</td>
            <td class="num ${diffClass(c.situacao.key)}">${Engine.formatK(c.diff, { signed: true })}</td>
          </tr>
        `).join('')
      : '<tr><td colspan="5" class="empty-state">Não há comentário cadastrado (Analise N2 / Relatorio) para este centro e período.</td></tr>';

    const accountsHtml = accounts.slice(0, 12).map((a) => `
      <tr>
        <td>${escapeHtml(a.tipo || '—')}</td>
        <td>${escapeHtml(a.comentario || '—')}</td>
        <td>${escapeHtml(a.conta)}</td>
        <td>${escapeHtml(a.contaDesc)}</td>
        <td class="num">${Engine.formatK(a.previsto)}</td>
        <td class="num">${Engine.formatK(a.realizado)}</td>
        <td class="num ${diffClass(a.situacao.key)}">${Engine.formatK(a.diff, { signed: true })}</td>
      </tr>
    `).join('');

    const monthTable = series.map((m) => {
      const noAct = !m.hasAct;
      const muted = m.beyondFilter || noAct;
      const diffTxt = noAct
        ? '—'
        : Engine.formatK(m.diff, { signed: true });
      const seal = monthSituacaoSeal(m);
      return `
      <tr class="${noAct ? 'row-sem-act' : muted ? 'row-muted' : ''}">
        <td title="${escapeHtml(m.label)}">${escapeHtml(m.label)}</td>
        <td class="num">${Engine.formatK(m.previsto)}</td>
        <td class="num">${m.hasAct ? Engine.formatK(m.realizado) : '—'}</td>
        <td class="num ${noAct ? '' : diffClass(m.situacao.key)}">${diffTxt}</td>
        <td><span class="badge-situacao ${seal.cls}" title="${escapeHtml(seal.full)}">${escapeHtml(seal.short)}</span></td>
      </tr>`;
    }).join('');

    const diffAccent = ccDetail.situacao.key === 'estouro'
      ? 'accent-red'
      : ccDetail.situacao.key === 'economia'
        ? 'accent-green'
        : 'accent-capri';

    $('#drawer-body').innerHTML = `
      <div class="detail-hero-row">
        <section class="dash-card detail-insight">
          <div class="dash-card-head">
            <h2>Em linguagem simples</h2>
            <span class="tag tag-plan">INSIGHT</span>
          </div>
          <p class="dash-card-text detail-insight-text">${escapeHtml(Engine.explainCc(ccDetail, accounts, filters))}</p>
        </section>
        <div class="kpi-grid-dash drawer-kpis-dash">
          <article class="dash-kpi accent-green">
            <div class="dash-kpi-top">
              <span class="kpi-label">Realizado</span>
              <span class="tag tag-real">REAL</span>
            </div>
            <strong>${Engine.formatK(ccDetail.realizado)}</strong>
            <span class="kpi-hint">ACT / PY no período</span>
          </article>
          <article class="dash-kpi accent-capri">
            <div class="dash-kpi-top">
              <span class="kpi-label">Previsto · ${escapeHtml(scenarioLabel)}</span>
              <span class="tag tag-plan">CENÁRIO</span>
            </div>
            <strong>${Engine.formatK(ccDetail.previsto)}</strong>
            <span class="kpi-hint">Base de comparação</span>
          </article>
          <article class="dash-kpi ${diffAccent}">
            <div class="dash-kpi-top">
              <span class="kpi-label">Diferença</span>
              <span class="tag tag-gap">GAP</span>
            </div>
            <strong class="${diffClass(ccDetail.situacao.key)}">${Engine.formatK(ccDetail.diff, { signed: true })}</strong>
            <span class="kpi-hint">${escapeHtml(ccDetail.situacao.label)} · ${Engine.formatPct(ccDetail.diff, ccDetail.previsto)}</span>
          </article>
        </div>
      </div>

      <section class="dash-card detail-chart-panel" aria-label="Evolução mês a mês">
        <div class="detail-chart-head">
          <div>
            <div class="dash-card-head" style="margin-bottom:0.15rem">
              <h2>Evolução mês a mês · ${escapeHtml(year)}</h2>
              <span class="tag tag-real">SÉRIE</span>
            </div>
            <p class="detail-chart-hint" id="chart-hint"></p>
          </div>
          <div class="chart-mode-toggle" role="group" aria-label="Modo do gráfico">
            <button type="button" class="chart-mode-btn" data-chart-mode="valores">Valores</button>
            <button type="button" class="chart-mode-btn" data-chart-mode="diff">Diferença</button>
            <button type="button" class="chart-mode-btn" data-chart-mode="pct">Desvio %</button>
          </div>
        </div>
        <div class="chart-outlier-chips chart-mini-kpis" id="chart-outlier-chips" aria-label="Resumo da evolução"></div>
        <div class="detail-chart-layout">
          <div class="chart-pane">
            <div class="chart-wrap"><canvas id="chart-mensal"></canvas></div>
          </div>
          <div class="table-wrap detail-month-table">
            <table class="data-table data-table-compact">
              <thead>
                <tr>
                  <th>Mês</th>
                  <th class="num">Previsto</th>
                  <th class="num">Realizado</th>
                  <th class="num">Diferença</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>${monthTable}</tbody>
            </table>
          </div>
        </div>
        <p class="table-footnote">Unidade: milhares (k) · Gráfico até o mês do filtro · Meses sem realizado ficam fora da diferença</p>
      </section>

      <div class="detail-grid-2">
        <section class="dash-card detail-panel">
          <div class="dash-card-head">
            <h2>Tipo de conta × Comentário</h2>
            <span class="tag tag-plan">N2</span>
          </div>
          <p class="detail-panel-sub">Comentários do Relatorio / Analise N2.</p>
          <div class="table-wrap detail-table-fill">
            <table class="data-table data-table-compact">
              <thead>
                <tr>
                  <th>Tipo de conta</th>
                  <th>Comentário</th>
                  <th class="num">Previsto</th>
                  <th class="num">Realizado</th>
                  <th class="num">Diferença</th>
                </tr>
              </thead>
              <tbody>${commentsHtml}</tbody>
            </table>
          </div>
        </section>

        <section class="dash-card detail-panel">
          <div class="dash-card-head">
            <h2>Contas contábeis</h2>
            <span class="tag tag-gap">IMPACTO</span>
          </div>
          <div class="table-wrap detail-table-fill">
            <table class="data-table data-table-compact">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Comentário</th>
                  <th>Conta</th>
                  <th>Descrição</th>
                  <th class="num">Previsto</th>
                  <th class="num">Realizado</th>
                  <th class="num">Diferença</th>
                </tr>
              </thead>
              <tbody>${accountsHtml || '<tr><td colspan="7" class="empty-state">Sem contas no período.</td></tr>'}</tbody>
            </table>
          </div>
          <p class="table-footnote">Ordenado pelo maior impacto absoluto · Valores em milhares (k)</p>
        </section>
      </div>
    `;

    const screen = $('#detail-screen');
    if (screen) screen.hidden = false;
    document.body.classList.add('detail-open');
    const bodyEl = $('#drawer-body');
    if (bodyEl) bodyEl.scrollTop = 0;

    state.chartSeries = series;
    state.chartFilters = filters;
    state.chartMode = 'auto';
    requestAnimationFrame(() => {
      bindChartModeToggle();
      renderChart(series, state.chartMode);
      requestAnimationFrame(() => {
        if (state.chart) state.chart.resize();
      });
    });
  }

  /** Selo curto da tabela mensal (texto + cor; title guarda o rótulo completo). */
  function monthSituacaoSeal(m) {
    if (!m.hasAct) {
      return { short: 'Sem ACT', cls: 'sem-act', full: 'Sem realizado' };
    }
    if (m.beyondFilter || m.situacao?.label === 'Fora do período') {
      return { short: 'Fora', cls: 'estavel', full: m.situacao?.label || 'Fora do período' };
    }
    const key = m.situacao?.key || 'estavel';
    if (key === 'estouro') return { short: 'Acima', cls: 'estouro', full: m.situacao.label };
    if (key === 'economia') return { short: 'Econ.', cls: 'economia', full: m.situacao.label };
    return { short: 'Dentro', cls: 'estavel', full: m.situacao?.label || 'Dentro do previsto' };
  }

  /** 3 mini-KPIs a partir da série já existente (sem novos cálculos de negócio). */
  function renderChartMiniKpis(fullSeries, filters) {
    const el = $('#chart-outlier-chips');
    if (!el) return;
    const months = Engine.MONTHS;
    const cutoff = months.indexOf(filters?.mes || 'ago');
    const lastIdx = cutoff >= 0 ? cutoff : (fullSeries?.length || 1) - 1;
    const withAct = (fullSeries || []).filter((s, i) => i <= lastIdx && s.hasAct);

    const acimaList = withAct.filter((s) => s.diff > 0);
    const ecoList = withAct.filter((s) => s.diff < 0);
    const maxAbove = acimaList.slice().sort((a, b) => b.diff - a.diff)[0] || null;
    const maxEco = ecoList.slice().sort((a, b) => a.diff - b.diff)[0] || null;
    const nAcima = acimaList.length;

    const card = (cls, label, value, title) => `
      <article class="chart-mini-kpi ${cls}" title="${escapeHtml(title || value)}">
        <span class="chart-mini-kpi-label">${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
      </article>`;

    el.hidden = false;
    el.classList.add('chart-mini-kpis');
    el.innerHTML = [
      card(
        maxAbove ? 'is-acima' : 'is-neutro',
        'Maior desvio',
        maxAbove
          ? `${maxAbove.label.slice(0, 3)} ${Engine.formatK(maxAbove.diff, { signed: true })}`
          : '—',
        maxAbove ? `Maior desvio: ${maxAbove.label} ${Engine.formatK(maxAbove.diff, { signed: true })}` : 'Sem meses acima do previsto'
      ),
      card(
        nAcima ? 'is-acima' : 'is-neutro',
        'Meses acima',
        String(nAcima),
        `${nAcima} mês(es) acima do previsto`
      ),
      card(
        maxEco ? 'is-economia' : 'is-neutro',
        'Economia',
        maxEco
          ? `${maxEco.label.slice(0, 3)} ${Engine.formatK(maxEco.diff, { signed: true })}`
          : '—',
        maxEco ? `Maior economia: ${maxEco.label} ${Engine.formatK(maxEco.diff, { signed: true })}` : 'Sem economia no período'
      )
    ].join('');
  }

  /** Meses do gráfico: até o mês do filtro; em Diferença/% só meses com realizado. */
  function seriesForChart(series, mode, filters) {
    const months = Engine.MONTHS;
    const cutoff = months.indexOf(filters?.mes || 'ago');
    const lastIdx = cutoff >= 0 ? cutoff : series.length - 1;
    let out = series.filter((_, i) => i <= lastIdx);
    if (mode === 'diff' || mode === 'pct') {
      out = out.filter((s) => s.hasAct);
    }
    // Se ainda vazio, mostra valores até o cutoff
    if (!out.length) out = series.filter((_, i) => i <= lastIdx);
    return out;
  }

  function chartHasOutliers(series) {
    const absVals = series
      .flatMap((s) => [s.realizado, s.previsto])
      .filter((v) => Math.abs(v) > 0)
      .map((v) => Math.abs(v))
      .sort((a, b) => a - b);
    const absDiffs = series
      .map((s) => Math.abs(s.diff))
      .filter((v) => v > 0)
      .sort((a, b) => a - b);
    const absPcts = series.map((s) => {
      if (!s.previsto) return s.realizado ? 100 : 0;
      return Math.abs((s.diff / Math.abs(s.previsto)) * 100);
    }).filter((v) => v > 0).sort((a, b) => a - b);

    function softFrom(sorted) {
      if (!sorted.length) return null;
      // Mediana resiste a 1–3 meses outliers (p75 falha quando há vários picos)
      const med = sorted[Math.floor((sorted.length - 1) / 2)] || sorted[0];
      return Math.max(med * 4, 1);
    }

    const softMax = softFrom(absVals);
    const softMaxDiff = softFrom(absDiffs);
    const softMaxPct = Math.min(softFrom(absPcts) || 200, 250);
    const peak = absVals.length ? absVals[absVals.length - 1] : 0;
    const peakDiff = absDiffs.length ? absDiffs[absDiffs.length - 1] : 0;
    const skewed = softMax != null && peak > softMax * 3;
    const skewedDiff = softMaxDiff != null && peakDiff > softMaxDiff * 3;
    const outliers = series.filter((s) => {
      const hitVal = softMax != null && (Math.abs(s.realizado) > softMax * 3 || Math.abs(s.previsto) > softMax * 3);
      const hitDiff = softMaxDiff != null && Math.abs(s.diff) > softMaxDiff * 3;
      return hitVal || hitDiff;
    });
    return { skewed: skewed || skewedDiff, softMax, softMaxDiff, softMaxPct, outliers, peak };
  }

  function resolveChartMode(series, mode) {
    if (mode && mode !== 'auto') return mode;
    // Preferir Valores quando houver meses só com previsto (evita falsa "economia")
    const onlyPlan = series.filter((s) => !s.hasAct && Math.abs(s.previsto) >= 0.5).length;
    if (onlyPlan >= 2) return 'valores';
    return chartHasOutliers(series).skewed ? 'diff' : 'valores';
  }

  function bindChartModeToggle() {
    document.querySelectorAll('[data-chart-mode]').forEach((btn) => {
      btn.onclick = () => {
        state.chartMode = btn.dataset.chartMode;
        renderChart(state.chartSeries || [], state.chartMode);
      };
    });
  }

  function syncChartModeUi(activeMode, meta, filters, fullSeries) {
    document.querySelectorAll('[data-chart-mode]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.chartMode === activeMode);
    });
    const hint = $('#chart-hint');
    const mesLabel = Engine.MONTH_LABELS[filters?.mes] || filters?.mes || '';
    if (hint) {
      if (activeMode === 'diff') {
        hint.textContent = meta.skewed
          ? `Diferença até ${mesLabel} · só meses com realizado · unidade milhares (k) · escala cortada nos picos (quebra no gráfico).`
          : `Diferença até ${mesLabel} · só meses com realizado · unidade milhares (k).`;
      } else if (activeMode === 'pct') {
        hint.textContent = meta.skewed
          ? `Desvio % até ${mesLabel} · só meses com realizado · escala limitada.`
          : `Desvio % até ${mesLabel} · só meses com realizado.`;
      } else if (meta.skewed) {
        hint.textContent = `Valores até ${mesLabel} · unidade milhares (k) · escala limitada a ~${Engine.formatK(meta.softMax)}.`;
      } else {
        hint.textContent = `Realizado versus previsto até ${mesLabel} · unidade milhares (k). Meses sem realizado: sem barra.`;
      }
    }
    renderChartMiniKpis(fullSeries || [], filters);
  }

  /** Tick numérico sem o "k" solto (unidade vai no subtítulo). */
  function formatAxisNumber(v) {
    const n = Number(v) || 0;
    const abs = Math.abs(n);
    if (abs >= 100) return n.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
    if (abs >= 10) return n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
    return n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  }

  /** Plugins: linha do zero + rótulos + marca de quebra em picos cortados. */
  function diffChartPlugins({ rawValues, soft, formatFn } = {}) {
    const format = formatFn || ((v) => Engine.formatK(v, { signed: true }));
    return [
      {
        id: 'zeroLine',
        afterDraw(chart) {
          const yScale = chart.scales.y;
          const { ctx, chartArea } = chart;
          if (!yScale || !chartArea) return;
          if (yScale.min > 0 || yScale.max < 0) return;
          const y = yScale.getPixelForValue(0);
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(chartArea.left, y);
          ctx.lineTo(chartArea.right, y);
          ctx.lineWidth = 1.75;
          ctx.strokeStyle = 'rgba(11, 42, 74, 0.55)';
          ctx.setLineDash([]);
          ctx.stroke();
          ctx.restore();
        }
      },
      {
        id: 'barLabelsAndBreak',
        afterDatasetsDraw(chart) {
          const meta0 = chart.getDatasetMeta(0);
          if (!meta0?.data?.length) return;
          const { ctx } = chart;
          meta0.data.forEach((bar, i) => {
            const raw = rawValues[i];
            if (raw == null || !Number.isFinite(raw)) return;
            const clipped = soft != null && Math.abs(raw) > soft + 1e-9;
            const label = format(raw);
            const x = bar.x;
            const tipY = bar.y;
            ctx.save();
            ctx.font = '700 10px Montserrat, "Bayer Sans", sans-serif';
            ctx.fillStyle = raw > 0 ? '#B42318' : raw < 0 ? '#3f9c00' : '#5c675f';
            ctx.textAlign = 'center';
            ctx.textBaseline = raw >= 0 ? 'bottom' : 'top';
            const ty = raw >= 0 ? tipY - (clipped ? 10 : 3) : tipY + (clipped ? 10 : 3);
            ctx.fillText(label, x, ty);

            if (clipped) {
              const w = Math.max(10, (bar.width || 16) * 0.55);
              const by = tipY;
              ctx.strokeStyle = raw > 0 ? '#B42318' : '#3f9c00';
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.moveTo(x - w / 2, by + (raw > 0 ? 4 : -4));
              ctx.lineTo(x - w / 6, by + (raw > 0 ? -2 : 2));
              ctx.lineTo(x + w / 6, by + (raw > 0 ? 4 : -4));
              ctx.lineTo(x + w / 2, by + (raw > 0 ? -2 : 2));
              ctx.stroke();
            }
            ctx.restore();
          });
        }
      }
    ];
  }

  function clipSigned(v, softMax) {
    if (softMax == null) return v;
    if (v > softMax) return softMax;
    if (v < -softMax) return -softMax;
    return v;
  }

  /** Escala Y assimétrica pelo dado real (não espelha ±softMax). */
  function signedAxisBounds(values, softMax) {
    const nums = (values || []).filter((v) => Number.isFinite(v));
    if (!nums.length) return softMax != null ? { max: softMax, min: 0 } : {};
    let dataMax = Math.max(...nums);
    let dataMin = Math.min(...nums);
    if (dataMax > 0) dataMax *= 1.06;
    if (dataMin < 0) dataMin *= 1.06;
    if (dataMax < 0) dataMax = 0;
    if (dataMin > 0) dataMin = 0;
    if (softMax != null) {
      dataMax = Math.min(dataMax, softMax);
      dataMin = Math.max(dataMin, -softMax);
    }
    return {
      max: dataMax,
      min: dataMin,
      suggestedMax: dataMax,
      suggestedMin: dataMin
    };
  }

  function renderChart(fullSeries, mode = 'auto') {
    const canvas = $('#chart-mensal');
    if (!canvas || typeof Chart === 'undefined' || !fullSeries?.length) return;
    if (state.chart) {
      state.chart.destroy();
      state.chart = null;
    }

    const filters = state.chartFilters || {};
    const activeMode = resolveChartMode(fullSeries, mode);
    const series = seriesForChart(fullSeries, activeMode, filters);
    const meta = chartHasOutliers(series);
    syncChartModeUi(activeMode, meta, filters, fullSeries);

    const labels = series.map((s) => s.label.slice(0, 3));
    let config;

    if (activeMode === 'pct') {
      const pctRaw = series.map((s) => {
        if (!s.previsto) return s.realizado ? 100 : 0;
        return (s.diff / Math.abs(s.previsto)) * 100;
      });
      const soft = meta.skewed ? meta.softMaxPct : null;
      const pctData = pctRaw.map((v) => clipSigned(v, soft));
      const yBounds = signedAxisBounds(pctData, soft);
      const barColor = (v) => (v > 1 ? 'rgba(180, 35, 24, 0.78)' : v < -1 ? 'rgba(76, 212, 0, 0.85)' : 'rgba(92, 103, 95, 0.4)');
      config = {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: 'Desvio %',
            data: pctData,
            backgroundColor: pctRaw.map(barColor),
            borderRadius: 0,
            maxBarThickness: 36,
            categoryPercentage: 0.7,
            barPercentage: 0.85
          }]
        },
        options: chartBaseOptions({
          legendColor: 'rgba(11, 42, 74, 0.55)',
          yTitle: null,
          maxTicksLimit: 5,
          tickFn: (v) => `${formatAxisNumber(v)}%`,
          tooltipFn: (ctx) => {
            const s = series[ctx.dataIndex];
            const raw = pctRaw[ctx.dataIndex];
            const clipped = soft != null && Math.abs(raw) > soft;
            return [
              `Desvio: ${raw.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%${clipped ? ' (fora da escala)' : ''}`,
              `Realizado: ${Engine.formatK(s.realizado)}`,
              `Previsto: ${Engine.formatK(s.previsto)}`
            ];
          },
          ...yBounds,
          beginAtZero: false
        }),
        plugins: diffChartPlugins({
          rawValues: pctRaw,
          soft,
          formatFn: (v) => `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
        })
      };
    } else if (activeMode === 'diff') {
      const diffRaw = series.map((s) => s.diff);
      const soft = meta.skewed ? meta.softMaxDiff : null;
      const diffData = diffRaw.map((v) => clipSigned(v, soft));
      const yBounds = signedAxisBounds(diffData, soft);
      const barColor = (v) => (v > 0 ? 'rgba(180, 35, 24, 0.82)' : v < 0 ? 'rgba(76, 212, 0, 0.88)' : 'rgba(92, 103, 95, 0.4)');
      config = {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: 'Diferença',
            data: diffData,
            backgroundColor: diffRaw.map(barColor),
            borderRadius: 0,
            maxBarThickness: 36,
            categoryPercentage: 0.7,
            barPercentage: 0.85
          }]
        },
        options: chartBaseOptions({
          legendColor: 'rgba(11, 42, 74, 0.55)',
          yTitle: null,
          maxTicksLimit: 5,
          tickFn: (v) => formatAxisNumber(v),
          tooltipFn: (ctx) => {
            const s = series[ctx.dataIndex];
            const clipped = soft != null && Math.abs(s.diff) > soft;
            return [
              `Diferença: ${Engine.formatK(s.diff, { signed: true })}${clipped ? ' (fora da escala)' : ''}`,
              `Realizado: ${Engine.formatK(s.realizado)}`,
              `Previsto: ${Engine.formatK(s.previsto)}`
            ];
          },
          ...yBounds,
          beginAtZero: true
        }),
        plugins: diffChartPlugins({ rawValues: diffRaw, soft })
      };
    } else {
      const softMax = meta.skewed ? meta.softMax : null;
      const clip = (v) => (softMax != null && Math.abs(v) > softMax ? softMax : v);
      // Sem realizado: null = sem barra (cinza só no rótulo do eixo)
      const realizadoData = series.map((s) => (s.hasAct ? clip(s.realizado) : null));
      const previstoData = series.map((s) => clip(s.previsto));
      const tickColors = series.map((s) => (s.hasAct ? 'rgba(11, 42, 74, 0.65)' : 'rgba(154, 168, 179, 0.95)'));
      config = {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              label: 'Realizado',
              data: realizadoData,
              backgroundColor: series.map((s) => (s.hasAct ? '#0B2A4A' : 'rgba(0,0,0,0)')),
              borderRadius: 0,
              maxBarThickness: 28,
              categoryPercentage: 0.72,
              barPercentage: 0.9,
              order: 2,
              spanGaps: false
            },
            {
              label: 'Previsto',
              data: previstoData,
              backgroundColor: series.map((s) => (s.hasAct ? '#4CD400' : 'rgba(154, 168, 179, 0.45)')),
              borderRadius: 0,
              maxBarThickness: 28,
              categoryPercentage: 0.72,
              barPercentage: 0.9,
              order: 1
            }
          ]
        },
        options: chartBaseOptions({
          yTitle: null,
          maxTicksLimit: 5,
          tickFn: (v) => formatAxisNumber(v),
          xTickColor: (ctx) => tickColors[ctx.index] || 'rgba(11, 42, 74, 0.65)',
          tooltipFn: (ctx) => {
            const s = series[ctx.dataIndex];
            if (ctx.dataset.label === 'Realizado' && !s.hasAct) {
              return 'Sem realizado';
            }
            const raw = ctx.dataset.label === 'Realizado' ? s.realizado : s.previsto;
            const clipped = softMax != null && Math.abs(raw) > softMax;
            return `${ctx.dataset.label}: ${Engine.formatK(raw)}${clipped ? ' (fora da escala)' : ''}`;
          },
          suggestedMax: softMax || undefined,
          max: softMax || undefined
        })
      };
    }

    state.chart = new Chart(canvas, config);
  }

  function renderOverviewChart(series, filters = {}) {
    const canvas = $('#chart-overview');
    if (!canvas || typeof Chart === 'undefined') return;
    if (state.overviewChart) {
      state.overviewChart.destroy();
      state.overviewChart = null;
    }
    const cutoff = Engine.MONTHS.indexOf(filters?.mes || 'ago');
    const lastIdx = cutoff >= 0 ? cutoff : (series?.length || 1) - 1;
    const slice = (series || []).filter((_, i) => i <= lastIdx);
    if (!slice.length) return;

    const hint = $('#overview-chart-hint');
    const mesLabel = Engine.MONTH_LABELS[filters?.mes] || filters?.mes || '';
    const scen = Engine.SCENARIO_LABELS[filters?.scenario] || filters?.scenario || 'FC2';
    if (hint) {
      const parts = [`Barras até ${mesLabel}`, scen];
      if (filters.unidade) parts.push(filters.unidade);
      if (filters.setor) parts.push(filters.setor);
      hint.textContent = `${parts.join(' · ')} · Realizado (ACT/PY) versus previsto.`;
    }

    state.overviewChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: slice.map((s) => s.label.slice(0, 3)),
        datasets: [
          {
            label: 'Realizado',
            data: slice.map((s) => (s.hasAct ? s.realizado : 0)),
            backgroundColor: '#00314E',
            borderRadius: 0,
            maxBarThickness: 34,
            categoryPercentage: 0.7,
            barPercentage: 0.9
          },
          {
            label: 'Previsto',
            data: slice.map((s) => s.previsto),
            backgroundColor: '#56d500',
            borderRadius: 0,
            maxBarThickness: 34,
            categoryPercentage: 0.7,
            barPercentage: 0.9
          }
        ]
      },
      options: chartBaseOptions({
        legendTop: true,
        tickFn: (v) => `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} k`,
        tooltipFn: (ctx) => {
          const s = slice[ctx.dataIndex];
          const raw = ctx.dataset.label === 'Realizado' ? s.realizado : s.previsto;
          if (ctx.dataset.label === 'Realizado' && !s.hasAct) return 'Realizado: — (sem ACT)';
          return `${ctx.dataset.label}: ${Engine.formatK(raw)}`;
        }
      })
    });
  }

  function chartBaseOptions({
    tickFn,
    tooltipFn,
    suggestedMax,
    suggestedMin,
    max,
    min,
    beginAtZero = true,
    legendColor,
    legendTop = false,
    yTitle = null,
    maxTicksLimit = 5,
    xTickColor = null
  } = {}) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 18, bottom: 4 } },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: legendTop ? 'top' : 'bottom',
          align: 'center',
          labels: {
            boxWidth: 12,
            boxHeight: 12,
            padding: 10,
            font: { size: 11, weight: '600' },
            color: 'rgba(11, 42, 74, 0.75)',
            generateLabels(chart) {
              const items = Chart.defaults.plugins.legend.labels.generateLabels(chart);
              if (!legendColor) return items;
              return items.map((item) => ({
                ...item,
                fillStyle: legendColor,
                strokeStyle: legendColor
              }));
            }
          }
        },
        tooltip: {
          callbacks: {
            label(ctx) {
              return tooltipFn(ctx);
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero,
          suggestedMax,
          suggestedMin,
          ...(max != null ? { max } : {}),
          ...(min != null ? { min } : {}),
          title: {
            display: Boolean(yTitle),
            text: yTitle || '',
            color: 'rgba(11, 42, 74, 0.45)',
            font: { size: 11, weight: '600' }
          },
          ticks: {
            callback: tickFn,
            font: { size: 10 },
            maxTicksLimit,
            color: 'rgba(11, 42, 74, 0.55)'
          },
          grid: {
            color: (ctx) => (ctx.tick.value === 0
              ? 'rgba(11, 42, 74, 0.35)'
              : 'rgba(11, 42, 74, 0.07)'),
            lineWidth: (ctx) => (ctx.tick.value === 0 ? 1.5 : 1),
            drawBorder: false
          }
        },
        x: {
          grid: { display: false },
          ticks: {
            font: { size: 11, weight: '600' },
            color: xTickColor || 'rgba(11, 42, 74, 0.65)'
          }
        }
      }
    };
  }

  function closeDrawer() {
    const screen = $('#detail-screen');
    if (screen) screen.hidden = true;
    document.body.classList.remove('detail-open', 'drawer-open');
    if (state.chart) {
      state.chart.destroy();
      state.chart = null;
    }
    state.chartSeries = null;
    state.chartFilters = null;
    state.chartMode = 'auto';
    state.contratoChart = null;
    state.contratoDrawer = null;
    state.contratoTlKey = null;
  }

  function setDrawerChrome({ kicker, title, meta, tagsHtml, backLabel }) {
    const kickerEl = document.querySelector('#detail-screen .detail-kicker');
    if (kickerEl && kicker) kickerEl.textContent = kicker;
    if (title != null) $('#drawer-title').textContent = title;
    if (meta != null) $('#drawer-meta').textContent = meta;
    const tagsEl = $('#drawer-tags');
    if (tagsEl && tagsHtml != null) tagsEl.innerHTML = tagsHtml;
    const back = $('#btn-fechar-drawer');
    if (back && backLabel) back.textContent = backLabel;
  }

  function lancRowMatchesMonth(row, mesKey) {
    if (!mesKey) return true;
    if (row.mesKey && row.mesKey === mesKey) return true;
    const parsed = Ksb1.parseSlotKey(mesKey);
    if (!parsed) return false;
    return Number(row.ano) === parsed.year && Number(row.periodo) === parsed.month;
  }

  function buildContratoLancRowsHtml(lanc, mesKey = null, label = '') {
    const filtered = (lanc || []).filter((r) => lancRowMatchesMonth(r, mesKey));
    if (!filtered.length) {
      return {
        html: `<tr><td colspan="5" class="empty-state">${
          mesKey
            ? `Sem lançamentos em ${escapeHtml(label || 'neste mês')}.`
            : 'Sem lançamentos deste contrato no histórico.'
        }</td></tr>`,
        count: 0,
        total: 0
      };
    }
    const show = filtered.slice(0, 150);
    const total = filtered.reduce((s, r) => s + (r.valor || 0), 0);
    return {
      html: show.map((r) => `
          <tr>
            <td>${escapeHtml(r.mesLabel || [r.periodo, r.ano].filter(Boolean).join('/') || '—')}</td>
            <td><strong>${escapeHtml(r.cc || '—')}</strong>${r.ccNome ? `<div class="muted-line">${escapeHtml(r.ccNome)}</div>` : ''}</td>
            <td>${escapeHtml(r.fornecedorNome || r.fornecedor || '—')}</td>
            <td>${escapeHtml(r.pedido || '—')}</td>
            <td class="num">${Ksb1.formatMoney(r.valor)}</td>
          </tr>`).join(''),
      count: filtered.length,
      total,
      shown: show.length
    };
  }

  function applyContratoTimelineMonth(mesKey) {
    const pack = state.contratoDrawer;
    if (!pack) return;
    const cell = (pack.cells || []).find((c) => c.key === mesKey) || null;
    // segundo clique no mesmo mês → volta a mostrar todos
    if (state.contratoTlKey === mesKey) mesKey = null;
    state.contratoTlKey = mesKey || null;

    document.querySelectorAll('.ksb1-tl-card').forEach((el) => {
      el.classList.toggle('is-active', Boolean(mesKey) && el.dataset.ksb1TlMes === mesKey);
    });

    const title = document.getElementById('ksb1-contrato-lanc-title');
    const tag = document.getElementById('ksb1-contrato-lanc-tag');
    const body = document.getElementById('tbody-ksb1-contrato-lanc');
    const foot = document.getElementById('ksb1-contrato-lanc-foot');
    const label = cell?.label || '';
    const built = buildContratoLancRowsHtml(pack.lanc, mesKey, label);
    if (title) {
      title.textContent = mesKey
        ? `Lançamentos · ${label}`
        : 'Lançamentos do contrato';
    }
    if (tag) tag.textContent = mesKey ? (label || 'MÊS') : 'KSB1';
    if (body) body.innerHTML = built.html;
    if (foot) {
      foot.textContent = mesKey
        ? (built.count
          ? `${built.count.toLocaleString('pt-BR')} lançamento(s) em ${label} · total ${Ksb1.formatMoney(built.total)}`
          : `Nenhum lançamento em ${label}`)
        : (built.count > 150
          ? `Exibindo 150 de ${built.count.toLocaleString('pt-BR')} lançamentos`
          : `${built.count.toLocaleString('pt-BR')} lançamento(s) no histórico`);
    }

    const panel = document.getElementById('ksb1-contrato-lanc-panel');
    if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /** Detalhe do contrato: linha do tempo de gap / atraso / compensação. */
  function openContratoDrawer(contract, historyRows = []) {
    if (!contract) return;
    const cells = contract.cells || [];
    const baseline = contract.baseline || 0;
    const lanc = (historyRows || [])
      .filter((r) => (r.contratoKey && r.contratoKey === contract.key)
        || (r.contrato && r.contrato === contract.contrato))
      .sort((a, b) => {
        const ya = Number(a.ano) || 0;
        const yb = Number(b.ano) || 0;
        if (ya !== yb) return ya - yb;
        return (Number(a.periodo) || 0) - (Number(b.periodo) || 0);
      });

    state.contratoDrawer = { contract, cells, lanc };
    state.contratoTlKey = null;

    setDrawerChrome({
      kicker: 'Contrato · linha do tempo',
      title: contract.contrato,
      meta: `${contract.area || '—'} · ${contract.statusLabel || ''} · típico ~ ${Ksb1.formatMoney(baseline)}`,
      backLabel: '← Voltar aos contratos',
      tagsHtml: `${statusBadge(contract.status, contract.statusLabel)}`
    });

    const timelineHtml = cells.map((cell) => {
      let tone = 'ok';
      let pill = 'Ok';
      if (cell.falta) { tone = 'falta'; pill = 'Falta'; }
      else if (cell.alto) { tone = 'alto'; pill = 'Alto'; }
      else if (cell.baixo) { tone = 'baixo'; pill = 'Baixo'; }
      return `
        <button type="button" class="ksb1-tl-card ksb1-tl-${tone}" data-ksb1-tl-mes="${escapeHtml(cell.key)}" title="Ver lançamentos de ${escapeHtml(cell.label)}">
          <header>
            <strong>${escapeHtml(cell.label)}</strong>
            <span class="tag ${tone === 'falta' ? 'tag-gap' : tone === 'alto' ? 'tag-real' : 'tag-plan'}">${pill}</span>
          </header>
          <p class="ksb1-tl-valor">${
            cell.falta && Math.abs(cell.valor) < 100
              ? '—'
              : Ksb1.formatMoney(cell.valor)
          }</p>
          <p class="ksb1-tl-meta">${cell.linhas || 0} lançamento(s) · clique para ver</p>
        </button>`;
    }).join('');

    const comps = contract.compensacoes || [];
    const compsHtml = comps.length
      ? `<ul class="ksb1-comp-list">${comps.map((c) => `
          <li><strong>${escapeHtml(c.faltou)}</strong> sem valor relevante → caiu em <strong>${escapeHtml(c.caiuEm)}</strong> (${Ksb1.formatMoney(c.valorCaiu)})</li>
        `).join('')}</ul>`
      : '<p class="detail-panel-sub">Nenhuma compensação detectada neste histórico.</p>';

    const monthRows = cells.map((cell) => {
      const vs = baseline > 0 ? (cell.valor / baseline) : 0;
      const vsTxt = baseline > 0 ? `${(vs * 100).toFixed(0)}% do típico` : '—';
      let sit = 'Ok';
      if (cell.falta) sit = 'Falta';
      else if (cell.alto) sit = 'Acima';
      else if (cell.baixo) sit = 'Abaixo';
      return `<tr class="${cell.falta ? 'ksb1-row-em_atraso' : ''}">
        <td>${escapeHtml(cell.label)}</td>
        <td class="num">${Ksb1.formatMoney(cell.valor)}</td>
        <td class="num">${cell.linhas || 0}</td>
        <td>${vsTxt}</td>
        <td>${statusBadge(
          cell.falta ? 'em_atraso' : cell.alto ? 'compensado' : cell.baixo ? 'irregular' : 'em_dia',
          sit
        )}</td>
      </tr>`;
    }).join('');

    const lancBuilt = buildContratoLancRowsHtml(lanc);

    $('#drawer-body').innerHTML = `
      <div class="kpi-grid-dash drawer-kpis-dash">
        <article class="dash-kpi accent-orange">
          <div class="dash-kpi-top"><span class="kpi-label">Situação</span><span class="tag tag-gap">STATUS</span></div>
          <strong class="kpi-value kpi-value-sm">${escapeHtml(contract.statusLabel || '—')}</strong>
          <span class="kpi-hint">${escapeHtml(contract.ultimoMes || 'último mês')}</span>
        </article>
        <article class="dash-kpi accent-blue">
          <div class="dash-kpi-top"><span class="kpi-label">Último mês</span><span class="tag tag-plan">VALOR</span></div>
          <strong class="kpi-value">${Ksb1.formatMoney(contract.ultimoValor || 0)}</strong>
          <span class="kpi-hint">${escapeHtml(contract.ultimoMes || '')}</span>
        </article>
        <article class="dash-kpi accent-green">
          <div class="dash-kpi-top"><span class="kpi-label">Total histórico</span><span class="tag tag-real">BRL</span></div>
          <strong class="kpi-value">${Ksb1.formatMoney(contract.total || 0)}</strong>
          <span class="kpi-hint">${cells.length} mês(es) no histórico</span>
        </article>
        <article class="dash-kpi accent-capri">
          <div class="dash-kpi-top"><span class="kpi-label">Patamar típico</span><span class="tag tag-plan">BASE</span></div>
          <strong class="kpi-value">${Ksb1.formatMoney(baseline)}</strong>
          <span class="kpi-hint">Mediana dos meses cheios</span>
        </article>
      </div>

      <section class="dash-card detail-insight">
        <div class="dash-card-head">
          <h2>Leitura da linha do tempo</h2>
          <span class="tag tag-plan">INSIGHT</span>
        </div>
        <p class="dash-card-text detail-insight-text">${escapeHtml(contract.leitura || '—')}</p>
      </section>

      <section class="dash-card" aria-label="Linha do tempo mensal">
        <div class="dash-card-head">
          <h2>Linha do tempo</h2>
          <span class="tag tag-gap">MÊS A MÊS</span>
        </div>
        <p class="detail-panel-sub">Clique em um mês para ver os lançamentos daquele período.</p>
        <div class="ksb1-timeline" id="ksb1-timeline">${timelineHtml || '<p class="empty-state">Sem meses no histórico.</p>'}</div>
        <div class="chart-wrap ksb1-contrato-chart-wrap"><canvas id="chart-ksb1-contrato" height="120"></canvas></div>
      </section>

      <div class="detail-grid-2">
        <section class="dash-card detail-panel">
          <div class="dash-card-head">
            <h2>Por mês</h2>
            <span class="tag tag-plan">RESUMO</span>
          </div>
          <div class="table-wrap">
            <table class="data-table data-table-compact">
              <thead>
                <tr>
                  <th>Mês</th>
                  <th class="num">Valor</th>
                  <th class="num">Linhas</th>
                  <th>vs típico</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>${monthRows || '<tr><td colspan="5" class="empty-state">—</td></tr>'}</tbody>
            </table>
          </div>
          <div class="dash-card-head" style="margin-top:1rem">
            <h2>Compensações</h2>
            <span class="tag tag-real">GAP→CAIU</span>
          </div>
          ${compsHtml}
        </section>

        <section class="dash-card detail-panel" id="ksb1-contrato-lanc-panel">
          <div class="dash-card-head">
            <h2 id="ksb1-contrato-lanc-title">Lançamentos do contrato</h2>
            <span class="tag tag-real" id="ksb1-contrato-lanc-tag">KSB1</span>
          </div>
          <div class="table-wrap detail-table-fill">
            <table class="data-table data-table-compact">
              <thead>
                <tr>
                  <th>Mês</th>
                  <th>CC</th>
                  <th>Fornecedor</th>
                  <th>Pedido</th>
                  <th class="num">Valor</th>
                </tr>
              </thead>
              <tbody id="tbody-ksb1-contrato-lanc">${lancBuilt.html}</tbody>
            </table>
          </div>
          <p class="table-footnote" id="ksb1-contrato-lanc-foot">${
            lancBuilt.count > 150
              ? `Exibindo 150 de ${lancBuilt.count.toLocaleString('pt-BR')} lançamentos`
              : `${lancBuilt.count.toLocaleString('pt-BR')} lançamento(s) no histórico`
          }</p>
        </section>
      </div>
    `;

    const screen = $('#detail-screen');
    if (screen) screen.hidden = false;
    document.body.classList.add('detail-open');
    const bodyEl = $('#drawer-body');
    if (bodyEl) bodyEl.scrollTop = 0;

    document.getElementById('ksb1-timeline')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-ksb1-tl-mes]');
      if (!btn) return;
      applyContratoTimelineMonth(btn.dataset.ksb1TlMes);
    });

    requestAnimationFrame(() => renderContratoChart(cells, baseline));
  }

  function renderContratoChart(cells, baseline) {
    const canvas = document.getElementById('chart-ksb1-contrato');
    if (!canvas || typeof Chart === 'undefined') return;
    if (state.chart) {
      state.chart.destroy();
      state.chart = null;
    }
    const labels = (cells || []).map((c) => c.label);
    const values = (cells || []).map((c) => c.valor || 0);
    const colors = (cells || []).map((c) => {
      if (c.falta) return 'rgba(180, 35, 24, 0.75)';
      if (c.alto) return 'rgba(11, 110, 79, 0.75)';
      if (c.baixo) return 'rgba(154, 91, 0, 0.7)';
      return 'rgba(0, 99, 165, 0.7)';
    });
    state.chart = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Valor no mês',
            data: values,
            backgroundColor: colors,
            borderRadius: 6,
            maxBarThickness: 48
          },
          ...(baseline > 0
            ? [{
                label: 'Patamar típico',
                data: labels.map(() => baseline),
                type: 'line',
                borderColor: 'rgba(0, 49, 78, 0.45)',
                borderDash: [6, 4],
                pointRadius: 0,
                borderWidth: 2
              }]
            : [])
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label(ctx) {
                return `${ctx.dataset.label}: ${Ksb1.formatMoney(ctx.parsed.y)}`;
              }
            }
          }
        },
        scales: {
          y: {
            ticks: {
              callback(v) {
                const n = Number(v) || 0;
                if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
                if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
                return String(n);
              }
            },
            grid: { color: 'rgba(0, 49, 78, 0.07)' }
          },
          x: { grid: { display: false } }
        }
      }
    });
  }

  function renderAdminSlots(versionsByForecast, yearOptions = [2026], selectedUploadYear = 2026) {
    fillUploadYearSelects(yearOptions, selectedUploadYear);
    const card = document.querySelector('.upload-card[data-slot="relatorio"]')
      || document.querySelector('.upload-card');
    const list = card?.querySelector('[data-year-list]');
    if (!list) return;

    // Um upload Relatorio grava nos 4 forecasts — mostra 1 linha por ano
    const byYear = new Map();
    Storage.FORECASTS.forEach((slot) => {
      (versionsByForecast?.[slot] || []).forEach((info) => {
        const y = Number(info.year);
        if (!y) return;
        const prev = byYear.get(y);
        const rows = info.rowCount || info.rows?.length || 0;
        if (!prev || rows >= (prev.rows || 0)) {
          byYear.set(y, {
            year: y,
            fileName: info.fileName || `Relatorio ${y}`,
            rows,
            uploadedAt: info.uploadedAt,
            slotKey: info.slotKey || Storage.slotKey(slot, y)
          });
        }
      });
    });

    const versions = [...byYear.values()].sort((a, b) => b.year - a.year);
    if (versions.length) {
      card?.classList.add('is-loaded');
      list.innerHTML = versions.map((info) => {
        const when = info.uploadedAt ? new Date(info.uploadedAt).toLocaleString('pt-BR') : '';
        const name = escapeHtml(info.fileName);
        return `<li>
          <span class="year-badge">${info.year}</span>
          <span class="year-meta" title="${name}">${name} · ${info.rows} linhas · ${escapeHtml(when)}</span>
          <span class="year-actions">
            <button type="button" data-download-key="${escapeHtml(info.slotKey)}">Baixar</button>
            <button type="button" data-clear-year="${info.year}">Remover</button>
          </span>
        </li>`;
      }).join('');
    } else {
      card?.classList.remove('is-loaded');
      list.innerHTML = '<li class="upload-year-empty">Nenhum Relatorio enviado ainda</li>';
    }
  }

  /** Lista de meses KSB1 no Admin — mesmo padrão do Relatorio (Baixar / Remover). */
  function renderAdminKsb1Slots(months = []) {
    const card = $('#upload-card-ksb1') || document.querySelector('.upload-card[data-slot="ksb1"]');
    const list = $('#ksb1-admin-list') || card?.querySelector('[data-ksb1-list]');
    if (!list) return;
    const monthsAsc = [...(months || [])].sort((a, b) => (a.year - b.year) || (a.month - b.month));
    if (!monthsAsc.length) {
      card?.classList.remove('is-loaded');
      list.innerHTML = '<li class="upload-year-empty">Nenhuma KSB1 enviada ainda</li>';
      return;
    }
    card?.classList.add('is-loaded');
    list.innerHTML = monthsAsc.map((m) => {
      const when = m.uploadedAt ? new Date(m.uploadedAt).toLocaleString('pt-BR') : '';
      const name = escapeHtml(m.fileName || m.label || m.key);
      const n = Number(m.rowCount || 0).toLocaleString('pt-BR');
      const badge = escapeHtml(m.label || m.key);
      return `<li>
        <span class="year-badge">${badge}</span>
        <span class="year-meta" title="${name}">${name} · ${n} linhas · ${escapeHtml(when)}</span>
        <span class="year-actions">
          <button type="button" data-download-key="${escapeHtml(m.key)}">Baixar</button>
          <button type="button" data-clear-ksb1="${escapeHtml(m.key)}">Remover</button>
        </span>
      </li>`;
    }).join('');
  }

  function syncActionsComposeUi(loggedIn) {
    const compose = $('#acoes-compose');
    const hint = $('#acoes-login-hint');
    if (compose) compose.hidden = !loggedIn;
    if (hint) hint.hidden = loggedIn;
  }

  function renderPeopleResumo() {
    const box = $('#pessoas-acoes-resumo');
    if (!box) return;
    const people = Actions.listPeople();
    const session = Auth.getSession();
    const managed = new Set(Actions.listPeopleManaged(session?.cwid).map((p) => p.nome));
    if (!people.length) {
      box.innerHTML = '<p class="detail-panel-sub">Nenhuma pessoa na lista ainda. Inclua acima.</p>';
      return;
    }
    box.innerHTML = `<p class="people-resumo-label">Pessoas no app (${people.length})</p>
      <div class="people-resumo-chips">${people.map((n) => {
        const mine = managed.has(n);
        return `<span class="person-chip">${escapeHtml(n)}${
          mine
            ? ` <button type="button" class="chip-x" data-exclude-pessoa-acao="${escapeHtml(n)}" title="Excluir">×</button>`
            : ''
        }</span>`;
      }).join('')}</div>`;
  }

  function renderActions(list = []) {
    const tbody = $('#tbody-acoes');
    const foot = $('#acoes-footnote');
    const datalist = $('#lista-pessoas-acoes');
    if (datalist) {
      datalist.innerHTML = Actions.listPeople()
        .map((n) => `<option value="${escapeHtml(n)}"></option>`)
        .join('');
    }
    renderPeopleResumo();
    syncActionsComposeUi(Auth.isLoggedIn());
    if (!tbody) return;
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Nenhuma ação neste filtro. Inclua uma nova acima (com login de Admin).</td></tr>';
      if (foot) foot.textContent = '0 ações';
      return;
    }
    const session = Auth.getSession();
    const loggedIn = Boolean(session);
    tbody.innerHTML = list.map((a) => {
      const mes = Engine.MONTH_LABELS[a.mes] || a.mes || '—';
      const basePeople = (a.quem || []).map((n) => `<span class="person-chip">${escapeHtml(n)}</span>`);
      const extraPeople = (a.quemExtra || []).map((x) => {
        const canRemove = session && x.addedBy === session.cwid;
        return `<span class="person-chip">${escapeHtml(x.nome)}${
          canRemove
            ? ` <button type="button" class="chip-x" data-remove-quem="${escapeHtml(a.id)}" data-nome="${escapeHtml(x.nome)}" title="Excluir pessoa">×</button>`
            : ''
        }</span>`;
      });
      const quemHtml = [...basePeople, ...extraPeople].join(' ') || '—';
      const status = a.concluido
        ? '<span class="badge economia">Concluída</span>'
        : '<span class="badge estouro">Aberta</span>';
      const canDelete = loggedIn && (a.source === 'admin' ? (!a.addedBy || a.addedBy === session.cwid) : true);
      const rowActions = loggedIn
        ? `<div class="row-actions">
            <button type="button" class="btn btn-ghost btn-compact" data-toggle-acao="${escapeHtml(a.id)}">${a.concluido ? 'Reabrir' : 'Concluir'}</button>
            ${canDelete ? `<button type="button" class="btn btn-ghost btn-compact btn-danger-text" data-delete-acao="${escapeHtml(a.id)}">Excluir</button>` : ''}
            <button type="button" class="btn btn-ghost btn-compact" data-add-quem-acao="${escapeHtml(a.id)}">+ Pessoa</button>
          </div>`
        : '—';
      return `<tr data-acao-id="${escapeHtml(a.id)}">
        <td>${escapeHtml(mes)}</td>
        <td>${escapeHtml(a.setor || '—')}</td>
        <td>${escapeHtml(a.comentario || '—')}</td>
        <td class="quem-cell">${quemHtml}</td>
        <td>${escapeHtml(a.prazo || '—')}</td>
        <td>${status}</td>
        <td>${rowActions}</td>
      </tr>`;
    }).join('');
    if (foot) {
      const abertas = list.filter((a) => !a.concluido).length;
      foot.textContent = `${list.length} ação(ões) · ${abertas} aberta(s) · ${Actions.listPeople().length} pessoa(s)`;
    }
  }

  function renderManagedPeople(list = []) {
    const tbody = $('#lista-pessoas-incluidas');
    if (!tbody) return;
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="3" class="empty-state">Nenhuma pessoa incluída por você ainda.</td></tr>';
      return;
    }
    tbody.innerHTML = list.map((p) => {
      const when = p.addedAt ? new Date(p.addedAt).toLocaleString('pt-BR') : '—';
      return `<tr>
        <td><strong>${escapeHtml(p.nome)}</strong></td>
        <td>${escapeHtml(when)}</td>
        <td><button type="button" class="btn btn-ghost btn-compact btn-danger-text" data-exclude-pessoa-acao="${escapeHtml(p.nome)}">Excluir</button></td>
      </tr>`;
    }).join('');
  }

  function renderCwidList(entries = []) {
    const tbody = $('#lista-cwids');
    if (!tbody) return;
    if (!entries.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Nenhuma pessoa cadastrada</td></tr>';
      return;
    }
    tbody.innerHTML = entries.map((entry) => {
      const nome = escapeHtml(entry.nome || '—');
      let situacao;
      if (entry.isRevoked) situacao = '<span class="badge estavel">Suspensa</span>';
      else if (entry.isExtra) situacao = '<span class="badge economia">Incluída no Admin</span>';
      else situacao = '<span class="badge">Lista base</span>';

      let actions = '—';
      if (entry.isRevoked) {
        actions = `<button type="button" class="btn btn-ghost btn-compact" data-restore-cwid="${escapeHtml(entry.cwid)}">Reativar</button>`;
      } else if (entry.canExclude) {
        actions = `<button type="button" class="btn btn-ghost btn-compact btn-danger-text" data-remove-cwid="${escapeHtml(entry.cwid)}">Excluir</button>`;
      }

      return `<tr class="${entry.isRevoked ? 'is-revoked' : ''}">
        <td><strong>${escapeHtml(entry.cwid)}</strong></td>
        <td>${nome}</td>
        <td>${situacao}</td>
        <td>${actions}</td>
      </tr>`;
    }).join('');
  }

  function fillSelectKeep(select, values, placeholder) {
    if (!select) return;
    const keep = select.value;
    select.innerHTML = `<option value="">${placeholder}</option>${(values || []).map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('')}`;
    if (keep && values.includes(keep)) select.value = keep;
  }

  function statusBadge(status, label) {
    const map = {
      em_atraso: 'tag-gap',
      gap_aberto: 'tag-gap',
      compensado: 'tag-real',
      irregular: 'tag-plan',
      em_dia: 'tag-plan',
      sem_historico: 'tag-plan'
    };
    const cls = map[status] || 'tag-plan';
    return `<span class="tag ${cls} ksb1-status-tag">${escapeHtml(label || status)}</span>`;
  }

  function ksb1GapFilterLabel(filter) {
    const map = {
      all: 'Todos',
      falta: 'Falta',
      compensado: 'Compensado',
      normal: 'Lançamentos'
    };
    return map[filter] || 'Todos';
  }

  function matchesKsb1GapFilter(contract, filter) {
    const f = filter || 'all';
    if (f === 'all') return true;
    const status = contract?.status || '';
    if (f === 'falta') return status === 'em_atraso' || status === 'gap_aberto';
    if (f === 'compensado') return status === 'compensado';
    if (f === 'normal') return status === 'em_dia' || status === 'irregular' || status === 'sem_historico';
    return true;
  }

  function syncKsb1GapFilterUi() {
    const current = state.ksb1GapStatusFilter || 'all';
    document.querySelectorAll('[data-ksb1-gap-filter]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.ksb1GapFilter === current);
    });
  }

  function renderContratos(rows = [], meta = null, filters = {}, opts = {}) {
    const filtered = Ksb1.filterRows(rows, filters);
    const sum = Ksb1.summary(filtered);
    const status = $('#ksb1-status');
    const pendingEl = $('#ksb1-pending-admin') || $('#ksb1-pending');
    const pendingMsg = $('#ksb1-admin-msg');
    const kpis = $('#contratos-kpis');
    const gapCard = $('#contratos-gap-card');
    const grid = $('#contratos-grid');
    const filt = $('#filtros-contratos');
    const btnClear = $('#btn-limpar-ksb1');
    const months = opts.months || meta?.months || [];
    const viewKey = opts.viewKey || meta?.viewKey || 'all';
    const pending = opts.pending || null;
    const analysis = opts.analysis || null;
    renderAdminKsb1Slots(months);

    const mesSelect = $('#filtro-ksb1-mes');
    if (mesSelect) {
      const cur = mesSelect.value || viewKey;
      mesSelect.innerHTML = [
        '<option value="all">Todos os meses</option>',
        ...months.map((m) => {
          const n = Number(m.rowCount || 0).toLocaleString('pt-BR');
          return `<option value="${escapeHtml(m.key)}">${escapeHtml(m.label)} · ${n} linhas</option>`;
        })
      ].join('');
      const prefer = months.some((m) => m.key === viewKey) ? viewKey : (months.some((m) => m.key === cur) ? cur : 'all');
      mesSelect.value = prefer;
    }

    if (pendingEl) {
      if (pending?.period) {
        const n = pending.rows?.length?.toLocaleString('pt-BR') || '0';
        const pendingMonths = pending.byMonth?.length
          || pending.meta?.monthCount
          || 1;
        const span = pendingMonths > 1 && pending.meta?.months?.length
          ? `${pendingMonths} meses (${pending.meta.months[0]} → ${pending.meta.months[pending.meta.months.length - 1]})`
          : pending.period.label;
        pendingEl.hidden = false;
        pendingEl.textContent = pendingMonths > 1
          ? `Pendente: ${span} · ${n} linhas — ao atualizar, grava cada mês no histórico (Jan, Fev…).`
          : `Pendente: ${span} (${n} linhas) — clique em Atualizar contratos para gravar no histórico.`
            + (months.length ? ` · ${months.length} mês(es) já gravados.` : '');
        if (pendingMsg) pendingMsg.textContent = pendingEl.textContent;
      } else {
        pendingEl.hidden = true;
        pendingEl.textContent = '';
      }
    }

    const histBox = $('#ksb1-history');
    const histList = $('#ksb1-history-list');
    if (histBox && histList) {
      if (!months.length) {
        histBox.hidden = true;
        histList.innerHTML = '';
      } else {
        histBox.hidden = false;
        const monthsAsc = [...months].sort((a, b) => (a.year - b.year) || (a.month - b.month));
        histList.innerHTML = monthsAsc.map((m) => {
          const when = m.uploadedAt
            ? new Date(m.uploadedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
            : '';
          const n = Number(m.rowCount || 0).toLocaleString('pt-BR');
          const active = viewKey === m.key ? ' is-active' : '';
          return `<li>
            <button type="button" class="ksb1-history-chip${active}" data-ksb1-month="${escapeHtml(m.key)}" title="${escapeHtml(m.fileName || m.label)}">
              <strong>${escapeHtml(m.label)}</strong>
              <span>${n} linhas</span>
              ${when ? `<span class="ksb1-history-when">${escapeHtml(when)}</span>` : ''}
            </button>
          </li>`;
        }).join('');
      }
    }

    const hasData = rows.length > 0 || Boolean(pending) || months.length > 0;
    if (!rows.length && !months.length) {
      if (status) {
        status.textContent = pending
          ? 'Arquivo lido — clique em Atualizar contratos para gravar no histórico.'
          : 'Nenhum arquivo KSB1 no histórico deste navegador.';
      }
      if (kpis) kpis.hidden = true;
      const monthGapsEmpty = $('#ksb1-month-gaps');
      if (monthGapsEmpty) monthGapsEmpty.hidden = true;
      if (gapCard) gapCard.hidden = true;
      if (grid) grid.hidden = true;
      if (filt) filt.hidden = !pending;
      if (btnClear) {
        btnClear.hidden = !pending;
        btnClear.textContent = pending ? 'Cancelar envio' : 'Remover mês';
      }
      if (!hasData) return;
      if (!rows.length && !months.length) return;
    }

    if (status) {
      const when = meta?.uploadedAt ? new Date(meta.uploadedAt).toLocaleString('pt-BR') : '';
      const areas = (meta?.areas || Ksb1.uniqueValues(rows, 'area')).join(', ');
      const raw = meta?.rowCountRaw != null
        ? ` · ${meta.rowCountRaw.toLocaleString('pt-BR')} no arquivo`
        : '';
      const hist = months.length
        ? ` · histórico: ${months.length} mês(es)`
        : '';
      const view = viewKey === 'all'
        ? 'Todos os meses'
        : (months.find((m) => m.key === viewKey)?.label || meta?.mesLabel || 'Mês');
      status.textContent = `${view} · ${meta?.fileName || meta?.source || 'KSB1'} · ${rows.length.toLocaleString('pt-BR')} linhas${raw}${hist}${when ? ` · ${when}` : ''}${areas ? ` · ${areas}` : ''}`;
    }
    if (kpis) kpis.hidden = false;
    if (grid) grid.hidden = !rows.length;
    if (filt) filt.hidden = false;
    if (btnClear) {
      btnClear.hidden = false;
      btnClear.textContent = pending ? 'Cancelar envio' : 'Remover mês';
    }

    const kpiGap = $('#ksb1-kpi-gap');
    const kpiGapVar = $('#ksb1-kpi-gap-var');
    const kpiComp = $('#ksb1-kpi-compensados');
    const kpiTotal = $('#ksb1-kpi-total');
    if (kpiGap) kpiGap.textContent = String(analysis?.kpis?.gap ?? analysis?.kpis?.gaps ?? 0);
    if (kpiGapVar) {
      const v = analysis?.kpis?.variacao;
      if (v && v.deltaGaps != null && v.mesPrev) {
        const sign = v.deltaGaps > 0 ? '+' : '';
        const valorPart = v.deltaValor != null
          ? ` · valor ${v.deltaValor > 0 ? '+' : ''}${Ksb1.formatMoney(v.deltaValor)}`
          : '';
        kpiGapVar.textContent = `Var ${sign}${v.deltaGaps} gaps vs ${v.mesPrev}${valorPart}`;
        kpiGapVar.classList.toggle('is-up', v.deltaGaps > 0);
        kpiGapVar.classList.toggle('is-down', v.deltaGaps < 0);
      } else if (v?.mes) {
        kpiGapVar.textContent = `${v.gaps} gap(s) em ${v.mes} · envie +1 mês p/ variação`;
        kpiGapVar.classList.remove('is-up', 'is-down');
      } else {
        kpiGapVar.textContent = 'Variação vs mês anterior';
        kpiGapVar.classList.remove('is-up', 'is-down');
      }
    }
    if (kpiComp) kpiComp.textContent = String(analysis?.kpis?.compensados ?? 0);
    if (kpiTotal) kpiTotal.textContent = Ksb1.formatMoney(sum.total);

    // Gap por mês (faixa abaixo dos KPIs)
    const monthGapCard = $('#ksb1-month-gaps');
    const monthGapStrip = $('#ksb1-month-gap-strip');
    const monthGapDetail = $('#ksb1-month-gap-detail');
    const byMonth = analysis?.byMonth || [];
    if (monthGapCard) monthGapCard.hidden = !byMonth.length;
    if (monthGapStrip) {
      if (!byMonth.length) {
        monthGapStrip.innerHTML = '';
      } else {
        const selected = state.ksb1MonthGapKey
          && byMonth.some((m) => m.key === state.ksb1MonthGapKey)
          ? state.ksb1MonthGapKey
          : (byMonth.find((m) => m.gaps > 0 && m.isLast)?.key
            || byMonth.find((m) => m.gaps > 0)?.key
            || byMonth[byMonth.length - 1].key);
        state.ksb1MonthGapKey = selected;
        const maxGaps = Math.max(...byMonth.map((m) => m.gaps || 0), 1);
        monthGapStrip.innerHTML = byMonth.map((m) => {
          const active = m.key === selected ? ' is-active' : '';
          const tone = m.gaps > 0 ? (m.isLast ? ' tone-atraso' : ' tone-gap') : ' tone-ok';
          const gapTxt = m.gaps === 0 ? '0' : String(m.gaps);
          const intensity = Math.round(((m.gaps || 0) / maxGaps) * 100);
          const tipParts = [
            m.gaps > 0
              ? `~ ${Ksb1.formatMoney(m.gapValor)} típico em falta`
              : `Valor lançado: ${Ksb1.formatMoney(m.valor)}`,
            m.compensou ? `${m.compensou} compensou` : null
          ].filter(Boolean);
          return `<button type="button" class="ksb1-month-gap-chip${tone}${active}" data-ksb1-month-gap="${escapeHtml(m.key)}" title="${escapeHtml(tipParts.join(' · '))}" aria-label="${escapeHtml(m.label)}: ${m.gaps} gap(s)${m.compensou ? `, ${m.compensou} compensou` : ''}">
            <strong>${escapeHtml(m.label)}</strong>
            <span class="ksb1-month-gap-count">${gapTxt}</span>
            <span class="ksb1-month-gap-bar" aria-hidden="true"><span style="width:${intensity}%"></span></span>
          </button>`;
        }).join('');

        const sel = byMonth.find((m) => m.key === selected);
        if (monthGapDetail && sel) {
          monthGapDetail.hidden = false;
          if (!sel.gaps) {
            monthGapDetail.innerHTML = `<p><strong>${escapeHtml(sel.label)}</strong> — sem gap. Valor lançado: ${Ksb1.formatMoney(sel.valor)}${
              sel.compensou
                ? ` · ${sel.compensou} contrato(s) compensaram falta anterior (${sel.compensouNomes.map(escapeHtml).join(', ')})`
                : ''
            }</p>`;
          } else {
            const list = (sel.faltas || []).map((f) => `
              <li>
                <div class="gap-contract-meta">
                  <button type="button" class="linkish ksb1-open-detail" data-ksb1-contrato="${escapeHtml(f.key)}">${escapeHtml(f.contrato)}</button>
                  <span class="muted-line">${escapeHtml(f.area || '')}</span>
                </div>
                <span class="gap-contract-valor" title="Típico ~ ${Ksb1.formatMoney(f.tipico)}">${Ksb1.formatMoneyCompact(f.tipico)}</span>
              </li>`).join('');
            monthGapDetail.innerHTML = `
              <p><strong>${escapeHtml(sel.label)}</strong> — ${sel.gaps} contrato(s) em falta
                (estimado ~ ${Ksb1.formatMoney(sel.gapValor)} pelo patamar típico)${
                  sel.isLast ? ' · <span class="tag tag-gap">Em atraso</span>' : ''
                }</p>
              <ul class="ksb1-month-gap-contracts">${list}</ul>`;
          }
        }
      }
    }

    // Gap / timeline table
    const theadGap = $('#thead-ksb1-gap');
    const tbodyGap = $('#tbody-ksb1-gap');
    const hintGap = $('#ksb1-gap-hint');
    if (gapCard) gapCard.hidden = !months.length;
    if (hintGap && analysis?.hint) hintGap.textContent = analysis.hint;
    syncKsb1GapFilterUi();
    if (theadGap && analysis?.months) {
      theadGap.innerHTML = `<tr>
        <th class="ksb1-hm-sticky">Contrato</th>
        ${analysis.months.map((m) => `<th class="num">${escapeHtml(m.label)}</th>`).join('')}
        <th>Situação</th>
        <th>Leitura</th>
        <th aria-label="Abrir linha do tempo"></th>
      </tr>`;
    }
    if (tbodyGap) {
      const allList = analysis?.contracts || [];
      const list = allList.filter((c) => matchesKsb1GapFilter(c, state.ksb1GapStatusFilter));
      const cols = 4 + (analysis?.months?.length || 0);
      if (!allList.length) {
        tbodyGap.innerHTML = `<tr><td colspan="${cols}" class="empty-state">${
          months.length < 2
            ? 'Envie e atualize pelo menos 2 meses para ver gap e compensação.'
            : 'Nenhum contrato monitorado no histórico.'
        }</td></tr>`;
      } else if (!list.length) {
        tbodyGap.innerHTML = `<tr><td colspan="${cols}" class="empty-state">Nenhum contrato neste filtro (${escapeHtml(ksb1GapFilterLabel(state.ksb1GapStatusFilter))}).</td></tr>`;
      } else {
        tbodyGap.innerHTML = list.map((c) => {
          const comps = c.compensacoes || [];
          const monthCells = (c.cells || []).map((cell, idx, arr) => {
            const compensou = comps.some((x) => x.caiuEm === cell.label);
            const isLast = idx === arr.length - 1;
            let cls = 'num ksb1-hm-cell';
            let statusTxt = 'Normal';
            if (cell.falta) {
              cls += ' ksb1-cell-falta';
              statusTxt = isLast && c.status === 'em_atraso' ? 'Em atraso' : 'Falta';
            } else if (compensou || cell.alto) {
              cls += compensou ? ' ksb1-cell-compensou' : ' ksb1-cell-alto';
              statusTxt = compensou ? 'Compensou' : 'Acima do típico';
            } else if (cell.baixo) {
              cls += ' ksb1-cell-baixo';
              statusTxt = 'Abaixo do típico';
            }
            const full = Ksb1.formatMoney(cell.valor);
            const short = cell.falta && Math.abs(cell.valor) < 100
              ? '—'
              : Ksb1.formatMoneyCompact(cell.valor);
            const title = `${statusTxt} · ${full}`;
            const mark = statusTxt === 'Falta' || statusTxt === 'Em atraso'
              ? 'F'
              : statusTxt === 'Compensou'
                ? 'C'
                : '';
            return `<td class="${cls}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">
              <span class="ksb1-hm-label">
                ${mark ? `<span class="ksb1-hm-mark" aria-hidden="true">${mark}</span>` : ''}
                <span>${short === '—' ? '<span class="ksb1-dash">—</span>' : escapeHtml(short)}</span>
              </span>
            </td>`;
          }).join('');
          return `<tr class="ksb1-row-${escapeHtml(c.status)} ksb1-gap-row" data-ksb1-contrato="${escapeHtml(c.key)}" tabindex="0" role="button" aria-label="Abrir linha do tempo de ${escapeHtml(c.contrato)}">
            <td class="ksb1-hm-sticky">
              <strong>${escapeHtml(c.contrato)}</strong>
              <div class="muted-line">${escapeHtml(c.area || '')}</div>
            </td>
            ${monthCells}
            <td>${statusBadge(c.status, c.statusLabel)}</td>
            <td class="ksb1-leitura" title="${escapeHtml(c.leitura)}">${escapeHtml(c.leitura)}</td>
            <td>
              <button type="button" class="ksb1-btn-timeline ksb1-open-detail" data-ksb1-contrato="${escapeHtml(c.key)}" aria-label="Ver linha do tempo de ${escapeHtml(c.contrato)}" title="Ver linha do tempo">↗</button>
            </td>
          </tr>`;
        }).join('');
      }
    }

    const areaSource = rows.length
      ? rows
      : (analysis?.contracts || []).map((c) => ({ area: c.area, contrato: c.contrato, cc: '' }));
    fillSelectKeep($('#filtro-ksb1-area'), Ksb1.uniqueValues(areaSource, 'area'), 'Todas');
    const areaVal = $('#filtro-ksb1-area')?.value || '';
    const contratosBase = areaVal ? areaSource.filter((r) => r.area === areaVal) : areaSource;
    fillSelectKeep($('#filtro-ksb1-contrato'), Ksb1.uniqueValues(contratosBase, 'contrato'), 'Todos');
    fillSelectKeep($('#filtro-ksb1-cc'), Ksb1.uniqueValues(rows, 'cc'), 'Todos');

    const rankBody = $('#tbody-ksb1-fornecedores');
    if (rankBody) {
      const rank = Ksb1.rankFornecedores(filtered, 20);
      rankBody.innerHTML = rank.length
        ? rank.map((r, i) => `
            <tr>
              <td>${i + 1}</td>
              <td><strong>${escapeHtml(r.nome)}</strong></td>
              <td>${escapeHtml(r.area)}</td>
              <td class="num">${r.linhas.toLocaleString('pt-BR')}</td>
              <td class="num">${r.pedidos.toLocaleString('pt-BR')}</td>
              <td class="num">${Ksb1.formatMoney(r.valor)}</td>
            </tr>
          `).join('')
        : '<tr><td colspan="6" class="empty-state">Nenhum contrato no filtro.</td></tr>';
    }

    const lancBody = $('#tbody-ksb1-lancamentos');
    if (lancBody) {
      const show = filtered.slice(0, 200);
      lancBody.innerHTML = show.length
        ? show.map((r) => {
            const forn = r.fornecedorNome || r.fornecedor || '—';
            return `
            <tr>
              <td class="cell-ellipsis" title="${escapeHtml(r.contrato || '')}"><strong>${escapeHtml(r.contrato || '—')}</strong><div class="muted-line">${escapeHtml(r.area || '')}</div></td>
              <td class="cell-ellipsis" title="${escapeHtml([r.cc, r.ccNome].filter(Boolean).join(' — '))}"><strong>${escapeHtml(r.cc || '—')}</strong>${r.ccNome ? `<div class="muted-line">${escapeHtml(r.ccNome)}</div>` : ''}</td>
              <td class="cell-ellipsis" title="${escapeHtml(forn)}">${escapeHtml(forn)}</td>
              <td class="num" title="${Ksb1.formatMoney(r.valor)}">${Ksb1.formatMoneyCompact(r.valor)}</td>
            </tr>`;
          }).join('')
        : '<tr><td colspan="4" class="empty-state">Nenhum lançamento no filtro.</td></tr>';
    }

    const foot = $('#ksb1-footnote');
    if (foot) {
      foot.textContent = filtered.length > 200
        ? `Valores em BRL (Val.in rep.cur.) · Exibindo 200 de ${filtered.length.toLocaleString('pt-BR')} linhas`
        : `Valores em BRL (Val.in rep.cur.) · ${filtered.length.toLocaleString('pt-BR')} linha(s)`;
    }
  }

  function syncAdminAuthUi(loggedIn) {
    const gate = $('#admin-gate');
    const workspace = $('#admin-workspace');
    const sessionActions = $('#admin-session-actions');
    const chip = $('#chip-admin-user');
    const sidebarLogout = $('#btn-sidebar-logout');
    const supaProfile = window.SupaAuth?.getProfile?.();
    const showLogout = Boolean(loggedIn || supaProfile?.email);
    if (gate) gate.hidden = loggedIn;
    if (workspace) workspace.hidden = !loggedIn;
    if (sessionActions) sessionActions.hidden = !loggedIn;
    if (sidebarLogout) sidebarLogout.hidden = !showLogout;
    if (chip) {
      const session = Auth.getSession();
      if (loggedIn && session) {
        chip.hidden = false;
        chip.textContent = session.nome
          ? `${session.cwid} · ${session.nome}`
          : `CWID ${session.cwid}`;
      } else if (supaProfile?.email) {
        chip.hidden = false;
        chip.textContent = supaProfile.nome
          ? `${supaProfile.email} · ${supaProfile.nome}`
          : supaProfile.email;
      } else {
        chip.hidden = true;
        chip.textContent = '';
      }
    }
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return {
    state,
    $,
    showToast,
    setTab,
    populateFilters,
    populateYearFilter,
    fillUploadYearSelects,
    syncYearModeUi,
    updateSetorOptions,
    readFilters,
    clearFilters,
    loadFilterPrefs,
    saveFilterPrefs,
    defaultFilterPrefs,
    applyFilterPrefs,
    syncFilterPrefsPanel,
    readFilterPrefsFromPanel,
    setFilterPrefsOpen,
    renderKpis,
    renderHomeSnapshot,
    renderOverviewChart,
    renderTree,
    renderRanking,
    openDrawer,
    closeDrawer,
    renderAdminSlots,
    renderAdminKsb1Slots,
    renderCwidList,
    renderActions,
    renderManagedPeople,
    renderContratos,
    openContratoDrawer,
    syncActionsComposeUi,
    syncAdminAuthUi
  };
})();
