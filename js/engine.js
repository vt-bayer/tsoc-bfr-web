/* Motor de filtros, agregações, ranking e textos em linguagem natural */
const Engine = (() => {
  const MONTHS = Parser.MONTHS;
  const MONTH_LABELS = {
    jan: 'Janeiro', fev: 'Fevereiro', mar: 'Março', abr: 'Abril',
    mai: 'Maio', jun: 'Junho', jul: 'Julho', ago: 'Agosto',
    set: 'Setembro', out: 'Outubro', nov: 'Novembro', dez: 'Dezembro'
  };
  const SCENARIO_LABELS = {
    budget: 'Budget', fc1: 'FC1', fc2: 'FC2', fc3: 'FC3'
  };

  const STABLE_PCT = 0.01;

  function monthsUpTo(month) {
    const idx = MONTHS.indexOf(month);
    return MONTHS.slice(0, idx + 1);
  }

  function sumMonths(obj, months) {
    return months.reduce((s, m) => s + (Number(obj?.[m]) || 0), 0);
  }

  function plannedOf(row, scenario) {
    if (scenario === 'budget') return row.bud;
    return row[scenario] || Parser.emptyMonths();
  }

  function classify(diff, planned) {
    const absPlanned = Math.abs(planned);
    if (absPlanned > 0 && Math.abs(diff) / absPlanned < STABLE_PCT) {
      return { key: 'estavel', label: 'Dentro do previsto' };
    }
    if (Math.abs(diff) < 1) return { key: 'estavel', label: 'Dentro do previsto' };
    if (diff > 0) return { key: 'estouro', label: 'Acima do previsto' };
    return { key: 'economia', label: 'Economia' };
  }

  function formatK(value, { signed = false } = {}) {
    // Relatorio já vem em milhares (k BRL) — só formatamos a exibição.
    const abs = Math.abs(value);
    let body;
    if (abs >= 100) body = abs.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
    else if (abs >= 10) body = abs.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
    else body = abs.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
    const sign = signed ? (value > 0 ? '+' : value < 0 ? '−' : '') : (value < 0 ? '−' : '');
    return `${sign}${body} k`;
  }

  function formatPct(diff, planned) {
    if (!planned) return '—';
    const pct = (Math.abs(diff) / Math.abs(planned)) * 100;
    return `${pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
  }

  /** Categorias típicas de gente — úteis para áreas como Sustentabilidade ocultarem. */
  const TIPOS_PESSOAS = new Set([
    'Benefícios',
    'Custos com Pessoal',
    'Encargos',
    'Estágio',
    'Hora extra',
    'Indenização',
    'Salários',
    'STI - PLR',
    'Temporários'
  ]);

  function isTipoPessoas(tipo) {
    return TIPOS_PESSOAS.has(String(tipo || '').trim());
  }

  function getFiltersFromUi(ui) {
    return {
      unidade: ui.unidade || '',
      setor: ui.setor || '',
      scenario: ui.scenario || 'fc3',
      periodo: ui.periodo || 'ytd',
      mes: ui.mes || 'ago',
      categoria: ui.categoria || '',
      busca: (ui.busca || '').trim().toLowerCase(),
      excludeTipos: Array.isArray(ui.excludeTipos) ? ui.excludeTipos.filter(Boolean) : [],
      onlyTipos: Array.isArray(ui.onlyTipos) ? ui.onlyTipos.filter(Boolean) : []
    };
  }

  function activeMonths(filters) {
    return filters.periodo === 'mes' ? [filters.mes] : monthsUpTo(filters.mes);
  }

  function filterRows(rows, filters) {
    const months = activeMonths(filters);
    const exclude = new Set(filters.excludeTipos || []);
    const only = new Set(filters.onlyTipos || []);
    return rows.filter((r) => {
      if (filters.unidade && r.unidade !== filters.unidade) return false;
      if (filters.setor && r.setor !== filters.setor) return false;
      if (filters.categoria && r.tipo !== filters.categoria) return false;
      if (exclude.size && exclude.has(r.tipo)) return false;
      if (only.size && !only.has(r.tipo)) return false;
      if (filters.busca) {
        const blob = `${r.cc} ${r.ccNome}`.toLowerCase();
        if (!blob.includes(filters.busca)) return false;
      }
      // mantém linhas sem movimento no período? filtramos depois na agregação
      const act = sumMonths(r.act, months);
      const plan = sumMonths(plannedOf(r, filters.scenario), months);
      return act !== 0 || plan !== 0 || Boolean(filters.busca);
    });
  }

  function enrich(row, filters) {
    const months = activeMonths(filters);
    const realizado = sumMonths(row.act, months);
    const previsto = sumMonths(plannedOf(row, filters.scenario), months);
    const diff = realizado - previsto;
    const situacao = classify(diff, previsto);
    return { ...row, realizado, previsto, diff, situacao, months };
  }

  function aggregateCostCenters(rows, filters) {
    const map = new Map();
    filterRows(rows, filters).forEach((r) => {
      const e = enrich(r, filters);
      const key = `${e.unidade}||${e.setor}||${e.cc}`;
      if (!map.has(key)) {
        map.set(key, {
          unidade: e.unidade,
          setor: e.setor,
          cc: e.cc,
          ccNome: e.ccNome,
          realizado: 0,
          previsto: 0,
          diff: 0,
          comentarios: new Set(),
          tipos: new Set(),
          accounts: []
        });
      }
      const agg = map.get(key);
      agg.realizado += e.realizado;
      agg.previsto += e.previsto;
      agg.diff += e.diff;
      if (e.ccNome) agg.ccNome = e.ccNome;
      if (e.comentario && e.comentario !== '-') agg.comentarios.add(e.comentario);
      if (e.tipo) agg.tipos.add(e.tipo);
      agg.accounts.push(e);
    });

    return Array.from(map.values()).map((a) => {
      const situacao = classify(a.diff, a.previsto);
      return {
        ...a,
        situacao,
        comentarios: Array.from(a.comentarios),
        tipos: Array.from(a.tipos)
      };
    });
  }

  function sortAttention(list) {
    return [...list].sort((a, b) => {
      // maior estouro (diff positivo) no topo, depois próximo de zero, depois maior economia
      const score = (x) => {
        if (x.diff > 0) return 1e12 + x.diff;
        if (x.situacao.key === 'estavel') return 1e9 - Math.abs(x.diff);
        return -Math.abs(x.diff);
      };
      return score(b) - score(a);
    });
  }

  /** Consolida centros de custo em linhas de setor (unidade + setor). */
  function aggregateSectors(ccList) {
    const map = new Map();
    (ccList || []).forEach((cc) => {
      const key = `${cc.unidade || ''}||${cc.setor || ''}`;
      if (!map.has(key)) {
        map.set(key, {
          level: 'setor',
          unidade: cc.unidade,
          setor: cc.setor,
          cc: cc.setor,
          ccNome: '',
          realizado: 0,
          previsto: 0,
          diff: 0,
          accounts: [],
          ccCodes: [],
          ccCount: 0
        });
      }
      const s = map.get(key);
      s.realizado += Number(cc.realizado) || 0;
      s.previsto += Number(cc.previsto) || 0;
      s.diff += Number(cc.diff) || 0;
      s.ccCount += 1;
      if (cc.cc) s.ccCodes.push(cc.cc);
      if (Array.isArray(cc.accounts) && cc.accounts.length) {
        s.accounts.push(...cc.accounts);
      }
    });
    return Array.from(map.values()).map((s) => ({
      ...s,
      ccCodes: [...new Set(s.ccCodes.filter(Boolean))],
      ccNome: `${s.ccCount} centro${s.ccCount === 1 ? '' : 's'} de custo`,
      situacao: classify(s.diff, s.previsto)
    }));
  }

  function buildUnitTree(ccList) {
    const units = new Map();
    ccList.forEach((cc) => {
      if (!units.has(cc.unidade)) {
        units.set(cc.unidade, {
          name: cc.unidade,
          realizado: 0,
          previsto: 0,
          diff: 0,
          sectors: new Map()
        });
      }
      const u = units.get(cc.unidade);
      u.realizado += cc.realizado;
      u.previsto += cc.previsto;
      u.diff += cc.diff;

      if (!u.sectors.has(cc.setor)) {
        u.sectors.set(cc.setor, {
          name: cc.setor,
          realizado: 0,
          previsto: 0,
          diff: 0,
          ccs: []
        });
      }
      const s = u.sectors.get(cc.setor);
      s.realizado += cc.realizado;
      s.previsto += cc.previsto;
      s.diff += cc.diff;
      s.ccs.push(cc);
    });

    return sortAttention(Array.from(units.values()).map((u) => {
      const sectors = sortAttention(Array.from(u.sectors.values()).map((s) => ({
        ...s,
        situacao: classify(s.diff, s.previsto),
        ccs: sortAttention(s.ccs)
      })));
      return {
        ...u,
        situacao: classify(u.diff, u.previsto),
        sectors
      };
    }));
  }

  function summary(ccList, filters, opts = {}) {
    const realizado = ccList.reduce((s, x) => s + x.realizado, 0);
    const previsto = ccList.reduce((s, x) => s + x.previsto, 0);
    const diff = realizado - previsto;
    const acima = ccList.filter((x) => x.diff > 0 && x.situacao.key === 'estouro').length;
    const situacao = classify(diff, previsto);
    const yearMode = opts.yearMode || 'current';
    const year = Number(opts.year) || null;
    let scenarioLabel = SCENARIO_LABELS[filters.scenario] || filters.scenario;
    if (yearMode === 'yoy' && year) scenarioLabel = `ano anterior (${year - 1})`;
    if (yearMode === 'py-only') scenarioLabel = 'sem base de comparação';
    return {
      ccs: ccList.length,
      realizado,
      previsto,
      diff,
      acima,
      situacao,
      yearMode,
      compareYear: yearMode === 'yoy' && year ? year - 1 : null,
      scenarioLabel,
      mesLabel: MONTH_LABELS[filters.mes],
      periodoLabel: filters.periodo === 'mes' ? `em ${MONTH_LABELS[filters.mes]}` : `acumulado até ${MONTH_LABELS[filters.mes]}`
    };
  }

  function naturalSummary(sum) {
    const diffAbs = formatK(Math.abs(sum.diff));
    let resultWord;
    if (sum.diff > 0) resultWord = `um estouro de ${diffAbs}`;
    else if (sum.diff < 0) resultWord = `uma economia de ${diffAbs}`;
    else resultWord = 'um resultado estável (diferença inferior a 1%)';
    return `Foram encontrados ${sum.ccs} centros de custo. O realizado foi de ${formatK(sum.realizado)}, contra ${formatK(sum.previsto)} previstos no ${sum.scenarioLabel} (${sum.periodoLabel}). O resultado é ${resultWord}, com ${sum.acima} centros de custo acima do previsto.`;
  }

  function accountImpact(ccDetail, filters) {
    const months = activeMonths(filters);
    const list = (ccDetail.accounts || []).map((a) => {
      const realizado = sumMonths(a.act, months);
      const previsto = sumMonths(plannedOf(a, filters.scenario), months);
      const diff = realizado - previsto;
      return {
        cc: a.cc || '',
        conta: a.conta,
        contaDesc: a.contaDesc || a.tipo,
        tipo: a.tipo,
        comentario: a.comentario && a.comentario !== '-' ? a.comentario : '',
        realizado,
        previsto,
        diff,
        situacao: classify(diff, previsto)
      };
    }).filter((a) => a.realizado || a.previsto);

    list.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
    return list;
  }

  function commentsByTipo(ccDetail, filters) {
    const months = activeMonths(filters);
    const map = new Map();
    (ccDetail.accounts || []).forEach((a) => {
      const comentario = String(a.comentario || '').trim();
      if (!comentario || comentario === '-') return;
      const tipo = a.tipo || 'Sem tipo';
      const key = `${tipo}||${comentario}`;
      if (!map.has(key)) {
        map.set(key, {
          tipo,
          comentario,
          realizado: 0,
          previsto: 0,
          diff: 0
        });
      }
      const row = map.get(key);
      const realizado = sumMonths(a.act, months);
      const previsto = sumMonths(plannedOf(a, filters.scenario), months);
      row.realizado += realizado;
      row.previsto += previsto;
      row.diff += realizado - previsto;
    });
    return Array.from(map.values())
      .map((r) => ({ ...r, situacao: classify(r.diff, r.previsto) }))
      .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  }

  function explainCc(ccDetail, accounts, filters) {
    const scenario = SCENARIO_LABELS[filters.scenario];
    const abs = formatK(Math.abs(ccDetail.diff));
    const top = accounts.slice(0, 3).map((a) => a.contaDesc || a.tipo || a.conta).filter(Boolean);
    const drivers = top.length
      ? top.join(', ').replace(/, ([^,]*)$/, ' e $1')
      : 'várias contas contábeis';
    const isSetor = ccDetail.level === 'setor';
    const subject = isSetor
      ? `O setor ${ccDetail.setor || ''}`
      : 'O centro de custo';

    if (ccDetail.diff > 0) {
      return `${subject} ficou ${abs} acima do previsto no ${scenario}, puxado principalmente por ${drivers}.`;
    }
    if (ccDetail.diff < 0) {
      return `${subject} ficou ${abs} abaixo do previsto no ${scenario}, principalmente por menores gastos nas contas de ${drivers}.`;
    }
    return `${subject} ficou alinhado ao previsto no ${scenario} no período selecionado.`;
  }

  function monthlyFromRows(rows, filters) {
    const cutoff = MONTHS.indexOf(filters?.mes || 'ago');
    const lastIdx = cutoff >= 0 ? cutoff : MONTHS.length - 1;
    return MONTHS.map((m, idx) => {
      const realizado = rows.reduce((s, r) => s + (r.act?.[m] || 0), 0);
      const previsto = rows.reduce((s, r) => s + (plannedOf(r, filters.scenario)?.[m] || 0), 0);
      const hasAct = Math.abs(realizado) >= 0.5;
      const beyondFilter = idx > lastIdx;
      // Sem ACT: não tratar previsto futuro como "economia"
      const diff = hasAct || (!previsto && realizado) ? realizado - previsto : 0;
      let situacao;
      if (beyondFilter) situacao = { key: 'estavel', label: 'Fora do período' };
      else if (!hasAct && Math.abs(previsto) >= 0.5) situacao = { key: 'estavel', label: 'Sem realizado' };
      else situacao = classify(diff, previsto);
      return {
        mes: m,
        label: MONTH_LABELS[m],
        realizado,
        previsto,
        diff,
        hasAct,
        beyondFilter,
        situacao
      };
    });
  }

  function monthlySeries(ccDetail, filters) {
    return monthlyFromRows(ccDetail.accounts || [], filters);
  }

  /** Série mensal do site (todas as linhas filtradas) — gráfico limpo do resumo. */
  function siteMonthlySeries(rows, filters) {
    const filtered = filterRows(rows, filters);
    return monthlyFromRows(filtered, filters);
  }

  /** Grupos do waterfall executivo (ordem = Power BI TSOC). */
  const WATERFALL_GROUP_ORDER = [
    'pessoas', 'energia', 'fam', 'others', 'it', 'logistics', 'waste', 'deprec', 'quality'
  ];
  const WATERFALL_GROUP_LABELS = {
    pessoas: 'Pessoas',
    energia: 'Energia',
    fam: 'FAM',
    others: 'Others',
    it: 'IT',
    logistics: 'Logistics',
    waste: 'Waste',
    deprec: 'Deprec.',
    quality: 'Quality'
  };

  function waterfallGroupId(tipo) {
    const t = String(tipo || '').trim();
    if (TIPOS_PESSOAS.has(t)) return 'pessoas';
    if (/energia/i.test(t)) return 'energia';
    if (/^fam$/i.test(t)) return 'fam';
    if (/^(it\b|cpd)/i.test(t) || /it suprimentos/i.test(t)) return 'it';
    if (/log[ií]stica/i.test(t)) return 'logistics';
    if (/meio ambiente/i.test(t)) return 'waste';
    if (/deprec/i.test(t)) return 'deprec';
    if (/an[aá]lises|qualidade|treinamentos/i.test(t)) return 'quality';
    return 'others';
  }

  /**
   * Waterfall Previsto → contribuições por grupo → Realizado.
   * GAP = realizado − previsto (economia negativa).
   */
  function waterfallByGroup(rows, filters) {
    const filtered = filterRows(rows, filters);
    const months = activeMonths(filters);
    const buckets = Object.fromEntries(
      WATERFALL_GROUP_ORDER.map((id) => [id, { realizado: 0, previsto: 0 }])
    );
    let realizado = 0;
    let previsto = 0;
    filtered.forEach((r) => {
      const act = sumMonths(r.act, months);
      const plan = sumMonths(plannedOf(r, filters.scenario), months);
      realizado += act;
      previsto += plan;
      const id = waterfallGroupId(r.tipo);
      buckets[id].realizado += act;
      buckets[id].previsto += plan;
    });

    const gap = realizado - previsto;
    const gapPct = Math.abs(previsto) > 0.5 ? (gap / Math.abs(previsto)) * 100 : 0;
    const startLabel = filters.periodo === 'mes' ? 'TSOC Mês' : 'TSOC YTD';
    const steps = [];
    let running = previsto;
    steps.push({
      label: startLabel,
      kind: 'total',
      value: previsto,
      from: 0,
      to: previsto
    });
    WATERFALL_GROUP_ORDER.forEach((id) => {
      const b = buckets[id];
      const diff = b.realizado - b.previsto;
      if (Math.abs(diff) < 0.05 && Math.abs(b.previsto) < 0.05 && Math.abs(b.realizado) < 0.05) {
        return;
      }
      const from = running;
      running += diff;
      steps.push({
        label: WATERFALL_GROUP_LABELS[id],
        kind: 'step',
        value: diff,
        from,
        to: running,
        groupId: id
      });
    });
    steps.push({
      label: 'Total',
      kind: 'total',
      value: realizado,
      from: 0,
      to: realizado
    });

    return {
      previsto,
      realizado,
      gap,
      gapPct,
      steps,
      startLabel,
      scenario: filters.scenario,
      mes: filters.mes,
      periodo: filters.periodo
    };
  }

  function metaFromRows(rows) {
    const unidades = [...new Set(rows.map((r) => r.unidade).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const tipos = [...new Set(rows.map((r) => r.tipo).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const setorMap = {};
    rows.forEach((r) => {
      if (!r.unidade) return;
      if (!setorMap[r.unidade]) setorMap[r.unidade] = new Set();
      if (r.setor) setorMap[r.unidade].add(r.setor);
    });
    Object.keys(setorMap).forEach((u) => {
      setorMap[u] = [...setorMap[u]].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    });
    const ccs = new Set(rows.map((r) => r.cc));
    return { unidades, tipos, setorMap, ccCount: ccs.size, rowCount: rows.length };
  }

  function toCsv(ccList, filters) {
    const header = ['Unidade', 'Setor', 'Centro de custo', 'Nome', 'Previsto', 'Realizado', 'Diferença', 'Situação', 'Cenário', 'Período', 'Mês'];
    const lines = [header.join(';')];
    sortAttention(ccList).forEach((r) => {
      lines.push([
        r.unidade,
        r.setor,
        r.cc,
        r.ccNome,
        r.previsto.toFixed(2).replace('.', ','),
        r.realizado.toFixed(2).replace('.', ','),
        r.diff.toFixed(2).replace('.', ','),
        r.situacao.label,
        SCENARIO_LABELS[filters.scenario],
        filters.periodo,
        filters.mes
      ].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';'));
    });
    return lines.join('\n');
  }

  /** Rótulo de linha da Analise N2 (Comentário; se vazio, usa Natureza/tipo). */
  function analiseN2Label(row) {
    const c = String(row?.comentario || '').trim();
    if (c && c !== '-') return c;
    const tipo = String(row?.tipo || '').trim();
    if (tipo) return tipo;
    return String(row?.contaDesc || row?.conta || '(sem comentário)').trim();
  }

  /**
   * Pivot Analise N2: Comentário × meses (ACT do Relatorio).
   * filters: { unidade, setor, natureza, tipoConta, cc, busca }
   */
  function pivotAnaliseN2(rows = [], filters = {}) {
    const unidade = String(filters.unidade || '').trim();
    const setor = String(filters.setor || '').trim();
    const natureza = String(filters.natureza || '').trim();
    const tipoConta = String(filters.tipoConta || '').trim();
    const cc = String(filters.cc || '').trim().toUpperCase();
    const busca = String(filters.busca || '').trim().toLowerCase();

    const scoped = (rows || []).filter((r) => {
      if (unidade && r.unidade !== unidade) return false;
      if (setor && r.setor !== setor) return false;
      if (natureza && r.tipo !== natureza) return false;
      if (tipoConta && String(r.grupo || '') !== tipoConta) return false;
      if (cc) {
        const rowCc = String(r.cc || '').toUpperCase();
        if (rowCc !== cc && !rowCc.includes(cc)) return false;
      }
      if (busca) {
        const blob = `${r.comentario || ''} ${r.tipo || ''} ${r.cc || ''} ${r.conta || ''} ${r.contaDesc || ''}`.toLowerCase();
        if (!blob.includes(busca)) return false;
      }
      return true;
    });

    const byLabel = new Map();
    scoped.forEach((r) => {
      const label = analiseN2Label(r);
      if (!byLabel.has(label)) {
        byLabel.set(label, {
          comentario: label,
          months: Object.fromEntries(MONTHS.map((m) => [m, 0])),
          total: 0,
          linhas: 0,
          ccs: new Set()
        });
      }
      const bag = byLabel.get(label);
      MONTHS.forEach((m) => {
        bag.months[m] += Number(r.act?.[m]) || 0;
      });
      bag.linhas += 1;
      if (r.cc) bag.ccs.add(r.cc);
    });

    const pivotRows = [...byLabel.values()].map((bag) => {
      const total = MONTHS.reduce((s, m) => s + (bag.months[m] || 0), 0);
      return {
        comentario: bag.comentario,
        months: bag.months,
        total,
        linhas: bag.linhas,
        ccCount: bag.ccs.size
      };
    }).filter((r) => Math.abs(r.total) >= 0.005)
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));

    // Meses com algum valor no recorte (ou até o mês do filtro global se informado)
    const mesCut = filters.mes && MONTHS.includes(filters.mes)
      ? MONTHS.indexOf(filters.mes)
      : -1;
    const activeMonths = MONTHS.filter((m, i) => {
      if (mesCut >= 0 && i > mesCut) return false;
      return pivotRows.some((r) => Math.abs(r.months[m] || 0) >= 0.005);
    });
    const months = activeMonths.length ? activeMonths : MONTHS.slice(0, Math.max(mesCut + 1, 1));

    const totals = Object.fromEntries(months.map((m) => [
      m,
      pivotRows.reduce((s, r) => s + (r.months[m] || 0), 0)
    ]));
    const grandTotal = pivotRows.reduce((s, r) => s + r.total, 0);

    const naturezas = [...new Set(scoped.map((r) => r.tipo).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const tipoContas = [...new Set(scoped.map((r) => r.grupo).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const setores = [...new Set(scoped.map((r) => r.setor).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const unidades = [...new Set(scoped.map((r) => r.unidade).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const ccs = [...new Set(scoped.map((r) => r.cc).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));

    // Options from full dataset (for filter dropdowns) when provided
    const all = rows || [];
    return {
      rows: pivotRows,
      months,
      totals,
      grandTotal,
      rowCount: pivotRows.length,
      lineCount: scoped.length,
      options: {
        unidades: [...new Set(all.map((r) => r.unidade).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
        setores: [...new Set(all.map((r) => r.setor).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
        naturezas: [...new Set(all.map((r) => r.tipo).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
        tipoContas: [...new Set(all.map((r) => r.grupo).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
        ccs: [...new Set(all.map((r) => r.cc).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
        scopedSetores: setores,
        scopedNaturezas: naturezas,
        scopedTipoContas: tipoContas,
        scopedUnidades: unidades,
        scopedCcs: ccs
      }
    };
  }

  return {
    MONTHS,
    MONTH_LABELS,
    SCENARIO_LABELS,
    TIPOS_PESSOAS,
    isTipoPessoas,
    getFiltersFromUi,
    filterRows,
    aggregateCostCenters,
    aggregateSectors,
    buildUnitTree,
    sortAttention,
    summary,
    naturalSummary,
    accountImpact,
    commentsByTipo,
    explainCc,
    monthlySeries,
    siteMonthlySeries,
    waterfallByGroup,
    WATERFALL_GROUP_LABELS,
    metaFromRows,
    formatK,
    formatPct,
    classify,
    toCsv,
    analiseN2Label,
    pivotAnaliseN2
  };
})();
