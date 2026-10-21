/* Parser e agregações da exportação KSB1 (Contratos TSOC) */
const Ksb1 = (() => {
  /**
   * Contratos monitorados (pastas 02 KSB1).
   * Upload operacional = KSB1 mensal do site (ex.: 09 KSB1 Belford Roxo_Set).
   * Match por Name of offsetting account (fornecedor).
   */
  const CONTRACT_AREAS = [
    {
      area: 'Site Logistic',
      contratos: [
        { key: 'fimatec', label: 'FIMATEC', match: /fimatec/i },
        { key: 'primary-logistic', label: 'Primary Logistic', match: /gt\s*solucoes\s*logisticas|primary\s*logistic/i }
      ]
    },
    {
      area: 'Infraestrutura',
      contratos: [
        { key: 'alsco', label: 'Alsco Toalheira', match: /alsco\s*toalheiro|alsco\s*toalheira|\balsco\b/i },
        { key: 'sodexo', label: 'Sodexo', match: /sodexo/i },
        { key: 'tursan', label: 'Tursan', match: /tursan/i }
      ]
    },
    {
      area: 'Segurança Industrial',
      contratos: [
        { key: 'segurpro', label: 'SEGURPRO', match: /segurpro/i },
        { key: 'arprotec', label: 'Arprotec', match: /arprotec/i },
        { key: 'g4s', label: 'G4S', match: /\bg4s\b/i },
        { key: 'gss', label: 'GSS', match: /\bgss\b/i },
        { key: 'cm-couto', label: 'CM Couto', match: /c\s*m\s*couto|cm\s*couto|couto\s*sist/i }
      ]
    },
    {
      area: 'Saúde Ocupacional',
      contratos: [
        { key: 'milaneli', label: 'Milaneli / SSO', match: /milaneli/i },
        { key: 'sustentabilidade', label: 'Base Sustentabilidade', match: /trust\s*gest|eloverde|sustentabilidade/i },
        // GAP SSMA — segurança do trabalho / SST (GAP Gestão Ambiental, GAP Sistemas, Nova GAP…)
        { key: 'gap', label: 'GAP (SSMA)', match: /\bgap\b|nova\s*gap|gap\s*gest|gap\s*sistemas|gap\s*ssma/i }
      ]
    }
  ];

  const MONITORED_KEYS = new Set(
    CONTRACT_AREAS.flatMap((a) => a.contratos.map((c) => c.key))
  );

  const MONTH_LABELS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const MONTH_NAME_MAP = {
    jan: 1, janeiro: 1,
    fev: 2, fevereiro: 2,
    mar: 3, marco: 3,
    abr: 4, abril: 4,
    mai: 5, maio: 5,
    jun: 6, junho: 6,
    jul: 7, julho: 7,
    ago: 8, agosto: 8,
    set: 9, setembro: 9,
    out: 10, outubro: 10,
    nov: 11, novembro: 11,
    dez: 12, dezembro: 12
  };

  function slotKey(year, month) {
    const y = Number(year);
    const m = Number(month);
    if (!(y >= 2000 && y <= 2100) || !(m >= 1 && m <= 12)) return null;
    return `ksb1_${y}_${String(m).padStart(2, '0')}`;
  }

  function parseSlotKey(key) {
    const m = String(key || '').match(/^ksb1_(\d{4})_(\d{2})$/);
    if (!m) return null;
    return { year: Number(m[1]), month: Number(m[2]) };
  }

  function monthLabel(month, year) {
    const m = Number(month);
    const label = MONTH_LABELS[m - 1] || String(m);
    return year ? `${label}/${year}` : label;
  }

  function majorityInt(values, { min = 1, max = 9999 } = {}) {
    const counts = new Map();
    (values || []).forEach((v) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < min || n > max) return;
      counts.set(n, (counts.get(n) || 0) + 1);
    });
    let best = null;
    let bestN = 0;
    counts.forEach((n, k) => {
      if (n > bestN) {
        best = k;
        bestN = n;
      }
    });
    return best;
  }

  function monthFromFileName(fileName = '') {
    const n = norm(fileName);
    if (!n) return null;
    // "09 KSB1 … Set" / "08-KSB1-Ago"
    const leading = n.match(/(?:^|[^\d])(0?[1-9]|1[0-2])(?:\s|_|-)/);
    if (leading) {
      const m = Number(leading[1]);
      if (m >= 1 && m <= 12) return m;
    }
    for (const [name, num] of Object.entries(MONTH_NAME_MAP)) {
      if (new RegExp(`(?:^|[^a-z])${name}(?:[^a-z]|$)`).test(n)) return num;
    }
    return null;
  }

  function yearFromFileName(fileName = '') {
    const m = String(fileName || '').match(/(20\d{2})/);
    return m ? Number(m[1]) : null;
  }

  function listPeriodsInRows(rows = []) {
    const set = new Set();
    (rows || []).forEach((r) => {
      const m = Number(r.periodo);
      if (m >= 1 && m <= 12) set.add(m);
    });
    return [...set].sort((a, b) => a - b);
  }

  /** Detecta ano/mês principal do arquivo (dados das linhas; fallback pelo nome). */
  function detectPeriod(rows = [], fileName = '', fallbackYear = new Date().getFullYear()) {
    const year = majorityInt(rows.map((r) => r.ano), { min: 2000, max: 2100 })
      || yearFromFileName(fileName)
      || Number(fallbackYear)
      || new Date().getFullYear();
    const present = listPeriodsInRows(rows);
    // Arquivo YTD (vários Period): usa o mês mais recente, não a maioria nem o "01" do nome
    let month = null;
    if (present.length > 1) month = present[present.length - 1];
    else if (present.length === 1) month = present[0];
    else month = monthFromFileName(fileName);
    if (!month) {
      throw new Error('Não foi possível identificar o mês da KSB1 (coluna Period ou nome do arquivo).');
    }
    const key = slotKey(year, month);
    const label = monthLabel(month, year);
    return {
      year,
      month,
      key,
      label,
      multi: present.length > 1,
      months: present.length ? present : [month]
    };
  }

  /** Marca cada linha com o mês da própria coluna Period (não o mês do nome do arquivo). */
  function tagRowsWithOwnPeriod(rows = [], { fallbackYear, fileName = '' } = {}) {
    const fileYear = yearFromFileName(fileName)
      || Number(fallbackYear)
      || new Date().getFullYear();
    const fileMonth = monthFromFileName(fileName);
    const out = [];
    let missing = 0;
    (rows || []).forEach((r) => {
      const year = Number(r.ano) || fileYear;
      let month = Number(r.periodo);
      if (!(month >= 1 && month <= 12)) month = fileMonth;
      if (!(month >= 1 && month <= 12)) {
        missing += 1;
        return;
      }
      const key = slotKey(year, month);
      out.push({
        ...r,
        ano: String(year),
        periodo: String(month),
        mesKey: key,
        mesLabel: monthLabel(month, year)
      });
    });
    if (!out.length) {
      throw new Error('Nenhuma linha com Period (mês) válido na KSB1.');
    }
    return { rows: out, missing };
  }

  /** Compat: carimba um período único (só quando a linha não tem Period). */
  function tagRowsWithPeriod(rows, period) {
    return (rows || []).map((r) => {
      const year = Number(r.ano) || period.year;
      const month = Number(r.periodo) || period.month;
      const key = slotKey(year, month) || period.key;
      return {
        ...r,
        ano: String(year),
        periodo: String(month),
        mesKey: key,
        mesLabel: monthLabel(month, year) || period.label
      };
    });
  }

  /** Agrupa linhas já tagueadas por mesKey → um slot por mês. */
  function groupRowsByMonth(rows = []) {
    const map = new Map();
    (rows || []).forEach((r) => {
      const key = r.mesKey || rowMonthKey(r);
      const parsed = parseSlotKey(key);
      if (!parsed) return;
      if (!map.has(key)) {
        map.set(key, {
          period: {
            year: parsed.year,
            month: parsed.month,
            key,
            label: r.mesLabel || monthLabel(parsed.month, parsed.year)
          },
          rows: []
        });
      }
      map.get(key).rows.push(r);
    });
    return [...map.values()]
      .map((g) => ({
        ...g,
        total: g.rows.reduce((s, r) => s + (r.valor || 0), 0)
      }))
      .sort((a, b) => (a.period.year - b.period.year) || (a.period.month - b.period.month));
  }

  function norm(s) {
    return String(s ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9.]+/g, ' ')
      .trim();
  }

  function toNumber(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v * 100) / 100;
    let t = String(v).trim().replace(/\s/g, '');
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
    else if (t.includes(',') && !t.includes('.')) t = t.replace(',', '.');
    const n = Number(t);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
  }

  function pickCol(headers, predicates) {
    for (let i = 0; i < headers.length; i += 1) {
      const h = headers[i];
      if (predicates.some((fn) => fn(h))) return i;
    }
    return -1;
  }

  function mapHeaders(rawHeaders) {
    const headers = rawHeaders.map(norm);
    return {
      ano: pickCol(headers, [
        (h) => h === 'fiscal year' || h === 'exercicio' || h === 'gjahr',
        (h) => h.includes('fiscal year') || h.includes('exercicio')
      ]),
      periodo: pickCol(headers, [
        (h) => h === 'period' || h === 'periodo' || h === 'monat',
        (h) => h === 'period'
      ]),
      conta: pickCol(headers, [
        (h) => h === 'cost element' || h === 'elemento do custo' || h === 'elemento de custo',
        (h) => h.includes('cost element') && !h.includes('name')
      ]),
      contaDesc: pickCol(headers, [
        (h) => h === 'cost element name' || h.includes('cost element name'),
        (h) => h.includes('denominacao') && h.includes('elemento')
      ]),
      cc: pickCol(headers, [
        (h) => h === 'cost center' || h === 'centro de custo',
        (h) => h.includes('cost center') && !h.includes('name')
      ]),
      ccNome: pickCol(headers, [
        (h) => h === 'co object name' || h.includes('co object name'),
        (h) => h.includes('nome') && h.includes('centro')
      ]),
      valor: pickCol(headers, [
        (h) => h.includes('val.in rep') || h.includes('val in rep'),
        (h) => h === 'valor na moeda do objeto' || h.includes('valor na moeda'),
        (h) => h === 'amount in doc curr' || h.includes('amount in doc'),
        (h) => h === 'valor' || h === 'amount' || h === 'betrag'
      ]),
      nome: pickCol(headers, [
        (h) => h === 'name' || h === 'nome'
      ]),
      fornecedorNome: pickCol(headers, [
        (h) => h.includes('name of offsetting account') || h.includes('offsetting account'),
        (h) => h.includes('nome do fornecedor') || h === 'vendor name',
        (h) => h === 'name 1'
      ]),
      fornecedor: pickCol(headers, [
        (h) => h === 'fornecedor' || h === 'vendor' || h === 'lifnr'
      ]),
      pedido: pickCol(headers, [
        (h) => h.includes('purchasing document') || h.includes('documento de compras'),
        (h) => h === 'pedido' || h === 'ebeln' || h === 'bestellung'
      ]),
      documento: pickCol(headers, [
        (h) => h === 'document number' || h.includes('document number'),
        (h) => h === 'documento' || h === 'belnr'
      ]),
      empresa: pickCol(headers, [
        (h) => h === 'empresa' || h === 'company' || h === 'contract' || h === 'contrato'
      ]),
      texto: pickCol(headers, [
        (h) => h.includes('purchase order text') || h.includes('document header text'),
        (h) => h === 'text' || h === 'texto' || h === 'assignment'
      ]),
      poText: pickCol(headers, [
        (h) => h.includes('purchase order text')
      ])
    };
  }

  function scoreMap(map) {
    return ['cc', 'valor', 'fornecedorNome', 'conta', 'pedido', 'periodo']
      .reduce((s, k) => s + (map[k] >= 0 ? 1 : 0), 0);
  }

  function findHeaderRow(matrix) {
    const maxScan = Math.min(matrix.length, 40);
    let best = { score: 0, idx: 0, map: null };
    for (let r = 0; r < maxScan; r += 1) {
      const map = mapHeaders(matrix[r] || []);
      const score = scoreMap(map);
      if (score > best.score) best = { score, idx: r, map };
      if (score >= 4) break;
    }
    return best;
  }

  function isDetailSheetName(name) {
    const n = norm(name);
    if (!n) return false;
    if (/(^| )resumo( |$)|summary|codigos|c[oó]digos fornecedor|contas a pagar|accounts payable/.test(n)) {
      return false;
    }
    // Aba Relatorio do TSOC nunca entra no fluxo de Contratos
    if (n === 'relatorio' || n.includes('relatorio')) return false;
    return true;
  }

  function sheetLooksLikeKsb1(matrix) {
    const found = findHeaderRow(matrix);
    return found.score >= 3 && found.map?.valor >= 0 && (found.map?.cc >= 0 || found.map?.fornecedorNome >= 0);
  }

  function cell(row, idx) {
    if (idx < 0) return '';
    const v = row[idx];
    return v == null ? '' : String(v).trim();
  }

  function inferContract(fornecedorBlob, _fileName = '', _sheetName = '') {
    const text = String(fornecedorBlob || '');
    for (const area of CONTRACT_AREAS) {
      for (const c of area.contratos) {
        if (c.match.test(text)) {
          return {
            area: area.area,
            contratoKey: c.key,
            contrato: c.label,
            monitored: true
          };
        }
      }
    }
    return {
      area: 'Outros',
      contratoKey: 'outro',
      contrato: 'Não classificado',
      monitored: false
    };
  }

  function isMonitoredRow(row) {
    return Boolean(row?.monitored) || MONITORED_KEYS.has(row?.contratoKey);
  }

  /** Reaplica o catálogo em linhas já gravadas (ex.: GAP entrou depois do 1º upload). */
  function reclassifyRows(rows = []) {
    let changed = 0;
    const out = (rows || []).map((r) => {
      const blob = `${r.fornecedorNome || ''} ${r.fornecedor || ''} ${r.empresa || ''}`;
      const inferred = inferContract(blob);
      if (
        r.contratoKey === inferred.contratoKey
        && r.contrato === inferred.contrato
        && r.area === inferred.area
        && Boolean(r.monitored) === inferred.monitored
      ) {
        return r;
      }
      changed += 1;
      return {
        ...r,
        area: inferred.area,
        contrato: inferred.contrato,
        contratoKey: inferred.contratoKey,
        monitored: inferred.monitored
      };
    });
    return { rows: out, changed };
  }

  function sheetToMatrix(sheet) {
    if (!sheet) return [];
    return XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
      raw: true,
      blankrows: false
    });
  }

  function parseMatrix(matrix, { fileName = 'ksb1', sheetName = 'KSB1' } = {}) {
    const found = findHeaderRow(matrix);
    if (found.score < 3) return { rows: [], meta: { skipped: true, reason: 'header', sheetName } };
    const map = found.map;
    const headerRow = matrix[found.idx] || [];
    const rows = [];

    for (let r = found.idx + 1; r < matrix.length; r += 1) {
      const line = matrix[r] || [];
      const valor = toNumber(line[map.valor]);
      const cc = cell(line, map.cc);
      const fornecedorNome = cell(line, map.fornecedorNome) || cell(line, map.fornecedor);
      const conta = cell(line, map.conta);
      const empresa = cell(line, map.empresa);
      if (!cc && !fornecedorNome && !conta && !valor) continue;
      const blob = `${cc} ${fornecedorNome} ${conta} ${empresa}`.toLowerCase();
      if (blob.includes('total geral') || blob === 'total' || /^\*+/.test(blob)) continue;

      const texto = cell(line, map.poText) || cell(line, map.texto) || cell(line, map.nome);
      // Classifica só pelo fornecedor (Name of offsetting account) — não pelo nome do arquivo
      const inferred = inferContract(`${fornecedorNome} ${empresa}`);

      rows.push({
        cc,
        ccNome: cell(line, map.ccNome),
        conta,
        contaDesc: cell(line, map.contaDesc),
        fornecedor: cell(line, map.fornecedor),
        fornecedorNome: fornecedorNome || empresa || '(sem fornecedor)',
        pedido: cell(line, map.pedido),
        documento: cell(line, map.documento),
        periodo: cell(line, map.periodo),
        ano: cell(line, map.ano),
        valor,
        texto,
        empresa,
        area: inferred.area,
        contrato: inferred.contrato,
        contratoKey: inferred.contratoKey,
        monitored: inferred.monitored,
        fonteArquivo: fileName,
        fonteAba: sheetName,
        moeda: 'BRL'
      });
    }

    return {
      rows,
      meta: {
        sheetName,
        headerRow: found.idx + 1,
        mapped: Object.fromEntries(Object.entries(map).map(([k, v]) => [k, v >= 0 ? headerRow[v] : null])),
        rowCount: rows.length
      }
    };
  }

  function parseWorkbook(workbook, fileName = 'ksb1.xlsx') {
    const names = workbook.SheetNames || [];
    const allRows = [];
    const sheetsUsed = [];
    const sheetMetas = [];

    // Preferência: aba Contratos (não a aba KSB1 do Excel TSOC, que confunde com Relatorio)
    const hasRelatorio = names.some((n) => {
      const x = norm(n);
      return x === 'relatorio' || x.includes('relatorio');
    });
    const ordered = [...names].sort((a, b) => {
      const score = (n) => {
        const x = norm(n);
        if (x === 'contratos' || x.startsWith('contrato')) return 0;
        if (x.startsWith('detalhe')) return 1;
        // Em arquivo TSOC (tem Relatorio), a aba KSB1 não é o extrato de contratos
        if (x === 'ksb1') return hasRelatorio ? 9 : 2;
        return 3;
      };
      return score(a) - score(b);
    });

    for (const name of ordered) {
      if (!isDetailSheetName(name)) continue;
      const x = norm(name);
      // Evita puxar a aba KSB1 do workbook TSOC (Relatorio + KSB1 no mesmo arquivo)
      if (hasRelatorio && x === 'ksb1') continue;
      const matrix = sheetToMatrix(workbook.Sheets[name]);
      if (!sheetLooksLikeKsb1(matrix)) continue;
      const parsed = parseMatrix(matrix, { fileName, sheetName: name });
      if (!parsed.rows.length) continue;
      allRows.push(...parsed.rows);
      sheetsUsed.push(name);
      sheetMetas.push(parsed.meta);
    }

    if (!allRows.length) {
      throw new Error(
        hasRelatorio
          ? `Este parece o Excel TSOC (tem aba Relatorio). Para Contratos, envie o extrato do site ou um arquivo com aba "Contratos" — não a aba KSB1 do TSOC.`
          : `Nenhuma aba de Contratos reconhecida em ${fileName}. Procure colunas Cost Center + Val.in rep.cur. + Name of offsetting account (ou renomeie a aba para Contratos).`
      );
    }

    return {
      rows: allRows,
      meta: {
        source: fileName,
        sheets: sheetsUsed,
        sheetMetas,
        rowCount: allRows.length,
        total: allRows.reduce((s, r) => s + r.valor, 0)
      }
    };
  }

  async function parseFile(file) {
    const name = file.name || 'ksb1.xlsx';
    const lower = name.toLowerCase();
    if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
      const text = await file.text();
      const wb = XLSX.read(text, { type: 'string', FS: ';' });
      return parseWorkbook(wb, name);
    }
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: false, sheetStubs: true });
    return parseWorkbook(wb, name);
  }

  async function parseFiles(fileList, { onlyMonitored = true } = {}) {
    const files = [...(fileList || [])];
    if (!files.length) throw new Error('Selecione ao menos um extrato de Contratos do site (não a aba KSB1 do Excel TSOC).');
    const raw = [];
    const sources = [];
    for (const file of files) {
      const parsed = await parseFile(file);
      raw.push(...parsed.rows);
      sources.push({
        fileName: file.name,
        rowsRaw: parsed.rows.length,
        rows: 0,
        total: 0,
        sheets: parsed.meta.sheets
      });
    }

    const merged = onlyMonitored ? raw.filter(isMonitoredRow) : raw;
    // Recalcula totais por arquivo após filtro
    const byFile = new Map(sources.map((s) => [s.fileName, s]));
    merged.forEach((r) => {
      const s = byFile.get(r.fonteArquivo);
      if (!s) return;
      s.rows += 1;
      s.total += r.valor || 0;
    });

    return {
      rows: merged,
      meta: {
        source: files.length === 1 ? files[0].name : `${files.length} arquivos KSB1`,
        sources,
        rowCount: merged.length,
        rowCountRaw: raw.length,
        onlyMonitored,
        total: merged.reduce((s, r) => s + r.valor, 0),
        areas: [...new Set(merged.map((r) => r.area))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
        contratos: [...new Set(merged.map((r) => r.contrato))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
      }
    };
  }

  const RELATORIO_MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  function emptyRelatorioMonths() {
    return Object.fromEntries(RELATORIO_MONTHS.map((m) => [m, 0]));
  }

  /**
   * Agrega lançamentos KSB1 (BRL) → ACT do Relatorio (milhares k), por CC + conta + mês.
   * Usa todas as linhas (não só contratos monitorados).
   */
  function aggregateRelatorioAct(rows = [], { year } = {}) {
    const yFilter = year != null ? Number(year) : null;
    const byKey = new Map();
    const monthsTouched = new Set();
    const yearsSeen = new Set();

    (rows || []).forEach((r) => {
      const y = Number(r.ano);
      if (yFilter && y && y !== yFilter) return;
      if (y >= 2000 && y <= 2100) yearsSeen.add(y);
      const monthNum = Number(r.periodo);
      if (!(monthNum >= 1 && monthNum <= 12)) return;
      const m = RELATORIO_MONTHS[monthNum - 1];
      const cc = normCcKey(r.cc);
      if (!cc) return;
      const conta = String(r.conta || '').trim();
      const key = `${cc}||${conta}`;
      if (!byKey.has(key)) {
        byKey.set(key, {
          ...emptyRelatorioMonths(),
          cc,
          conta,
          ccNome: String(r.ccNome || '').trim(),
          contaDesc: String(r.contaDesc || '').trim()
        });
      }
      const bag = byKey.get(key);
      // Relatorio trabalha em milhares (k)
      const k = (Number(r.valor) || 0) / 1000;
      bag[m] = Math.round((bag[m] + k) * 100) / 100;
      monthsTouched.add(m);
      if (r.ccNome) bag.ccNome = String(r.ccNome).trim();
      if (r.contaDesc) bag.contaDesc = String(r.contaDesc).trim();
    });

    return {
      year: yFilter || (yearsSeen.size === 1 ? [...yearsSeen][0] : null),
      years: [...yearsSeen].sort((a, b) => a - b),
      byKey,
      monthsTouched: [...monthsTouched],
      keyCount: byKey.size
    };
  }

  function formatMoney(value, { signed = false } = {}) {
    const abs = Math.abs(Number(value) || 0);
    const body = abs.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const sign = signed ? (value > 0 ? '+' : value < 0 ? '−' : '') : (value < 0 ? '−' : '');
    return `${sign}${body}`;
  }

  /** Valor abreviado para células compactas (tooltip guarda o completo). */
  function formatMoneyCompact(value) {
    const n = Number(value) || 0;
    const abs = Math.abs(n);
    const sign = n < 0 ? '−' : '';
    if (abs >= 1e6) {
      return `${sign}${(abs / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} M`;
    }
    if (abs >= 1e3) {
      return `${sign}${(abs / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} k`;
    }
    return formatMoney(n);
  }

  function normCcKey(cc) {
    const s = String(cc || '').toUpperCase().trim();
    const m = s.match(/MW\d+[A-Z0-9]*/);
    return m ? m[0] : s.replace(/[^A-Z0-9]/g, '');
  }

  function filterRows(rows, filters = {}) {
    const busca = String(filters.busca || '').trim().toLowerCase();
    const cc = String(filters.cc || '').trim();
    const ccNorm = cc ? normCcKey(cc) : '';
    const ccsSet = Array.isArray(filters.ccs) && filters.ccs.length
      ? new Set(filters.ccs.map(normCcKey).filter(Boolean))
      : null;
    const fornecedor = String(filters.fornecedor || '').trim().toLowerCase();
    const area = String(filters.area || '').trim();
    const contrato = String(filters.contrato || '').trim();
    return (rows || []).filter((r) => {
      if (area && r.area !== area) return false;
      if (contrato && r.contrato !== contrato) return false;
      const rowCc = normCcKey(r.cc);
      if (ccsSet) {
        if (!ccsSet.has(rowCc)) return false;
      } else if (ccNorm && rowCc !== ccNorm) {
        return false;
      }
      if (fornecedor) {
        const blob = `${r.fornecedor} ${r.fornecedorNome} ${r.empresa}`.toLowerCase();
        if (!blob.includes(fornecedor)) return false;
      }
      if (busca) {
        const blob = `${r.cc} ${r.ccNome} ${r.conta} ${r.contaDesc} ${r.fornecedor} ${r.fornecedorNome} ${r.pedido} ${r.texto} ${r.contrato} ${r.area}`.toLowerCase();
        if (!blob.includes(busca)) return false;
      }
      return true;
    });
  }

  function summary(rows) {
    const list = rows || [];
    const total = list.reduce((s, r) => s + (r.valor || 0), 0);
    const fornecedores = new Set(list.map((r) => r.fornecedorNome || r.fornecedor).filter(Boolean));
    const ccs = new Set(list.map((r) => r.cc).filter(Boolean));
    const pedidos = new Set(list.map((r) => r.pedido).filter(Boolean));
    const contratos = new Set(list.map((r) => r.contrato).filter(Boolean));
    return {
      linhas: list.length,
      total,
      fornecedores: fornecedores.size,
      ccs: ccs.size,
      pedidos: pedidos.size,
      contratos: contratos.size
    };
  }

  function rankFornecedores(rows, limit = 20) {
    const map = new Map();
    (rows || []).forEach((r) => {
      const key = r.contrato || r.fornecedorNome || r.fornecedor || '(sem fornecedor)';
      if (!map.has(key)) {
        map.set(key, {
          nome: key,
          area: r.area || 'Outros',
          codigo: r.fornecedor || '',
          valor: 0,
          linhas: 0,
          pedidos: new Set()
        });
      }
      const agg = map.get(key);
      agg.valor += r.valor || 0;
      agg.linhas += 1;
      if (r.pedido) agg.pedidos.add(r.pedido);
    });
    return [...map.values()]
      .map((a) => ({ ...a, pedidos: a.pedidos.size }))
      .sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor))
      .slice(0, limit);
  }

  function rankAreas(rows) {
    const map = new Map();
    (rows || []).forEach((r) => {
      const key = r.area || 'Outros';
      if (!map.has(key)) map.set(key, { area: key, valor: 0, linhas: 0, contratos: new Set() });
      const agg = map.get(key);
      agg.valor += r.valor || 0;
      agg.linhas += 1;
      if (r.contrato) agg.contratos.add(r.contrato);
    });
    return [...map.values()]
      .map((a) => ({ ...a, contratos: a.contratos.size }))
      .sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));
  }

  function uniqueValues(rows, field) {
    return [...new Set((rows || []).map((r) => r[field]).filter(Boolean))]
      .sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));
  }

  function median(nums) {
    const arr = (nums || []).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
    if (!arr.length) return 0;
    const mid = Math.floor(arr.length / 2);
    return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
  }

  function rowMonthKey(row) {
    if (row?.mesKey && parseSlotKey(row.mesKey)) return row.mesKey;
    const y = Number(row?.ano);
    const m = Number(row?.periodo);
    return slotKey(y, m);
  }

  /**
   * Gap / atraso / compensação por contrato ao longo dos meses do histórico.
   * - Falta: mês com KSB1 no histórico, mas contrato ~zerado
   * - Compensou: mês alto depois de uma falta
   * - Em atraso: falta no último mês do histórico
   */
  function analyzeTimeline(rows, monthsMeta = [], opts = {}) {
    const noise = Number(opts.noise) || 100;
    const lowRatio = Number(opts.lowRatio) || 0.15;
    const highRatio = Number(opts.highRatio) || 1.55;
    const months = [...(monthsMeta || [])]
      .filter((m) => m?.key && m.year && m.month)
      .sort((a, b) => (a.year - b.year) || (a.month - b.month));

    if (!months.length) {
      return {
        months: [],
        contracts: [],
        kpis: { emAtraso: 0, gaps: 0, compensados: 0, emDia: 0, total: 0 },
        ready: false,
        hint: 'Envie e atualize pelo menos um mês de KSB1.'
      };
    }

    const monthKeys = months.map((m) => m.key);
    const byContract = new Map();

    (rows || []).forEach((r) => {
      if (!isMonitoredRow(r) && !MONITORED_KEYS.has(r.contratoKey)) return;
      const key = r.contratoKey || norm(r.contrato) || r.contrato;
      if (!key || key === 'outro') return;
      const mk = rowMonthKey(r);
      if (!mk || !monthKeys.includes(mk)) return;
      if (!byContract.has(key)) {
        byContract.set(key, {
          key,
          contrato: r.contrato || key,
          area: r.area || 'Outros',
          byMonth: Object.fromEntries(monthKeys.map((k) => [k, { valor: 0, linhas: 0 }]))
        });
      }
      const agg = byContract.get(key);
      if (!agg.byMonth[mk]) agg.byMonth[mk] = { valor: 0, linhas: 0 };
      agg.byMonth[mk].valor += r.valor || 0;
      agg.byMonth[mk].linhas += 1;
      if (r.contrato) agg.contrato = r.contrato;
      if (r.area) agg.area = r.area;
    });

    // Inclui todos os contratos do catálogo (ex.: GAP ainda sem lançamento no histórico)
    CONTRACT_AREAS.forEach((area) => {
      area.contratos.forEach((c) => {
        if (byContract.has(c.key)) return;
        byContract.set(c.key, {
          key: c.key,
          contrato: c.label,
          area: area.area,
          byMonth: Object.fromEntries(monthKeys.map((k) => [k, { valor: 0, linhas: 0 }])),
          fromCatalog: true
        });
      });
    });

    const statusRank = { em_atraso: 0, gap_aberto: 1, compensado: 2, irregular: 3, em_dia: 4, sem_historico: 5 };

    const contracts = [...byContract.values()].map((c) => {
      const series = months.map((m) => {
        const cell = c.byMonth[m.key] || { valor: 0, linhas: 0 };
        return {
          key: m.key,
          label: m.label || monthLabel(m.month, m.year),
          year: m.year,
          month: m.month,
          valor: cell.valor || 0,
          linhas: cell.linhas || 0
        };
      });

      const positive = series.map((s) => Math.abs(s.valor)).filter((v) => v > noise);
      const maxV = positive.length ? Math.max(...positive) : 0;
      // Ignora meses "quase zero" na mediana — o típico é o patamar cheio do contrato
      const core = positive.filter((v) => v >= maxV * 0.25);
      const baseline = median(core.length ? core : positive);
      const cells = series.map((s) => {
        const abs = Math.abs(s.valor);
        const falta = abs <= noise || (baseline > noise && abs < baseline * lowRatio);
        const alto = baseline > noise && s.valor >= baseline * highRatio;
        const baixo = !falta && baseline > noise && abs < baseline * 0.55;
        return { ...s, falta, alto, baixo, baseline };
      });

      const faltas = cells.filter((x) => x.falta);
      const compensacoes = [];
      cells.forEach((cell, idx) => {
        if (cell.falta || Math.abs(cell.valor) <= noise) return;
        const prevFaltas = cells.slice(0, idx).filter((p) => p.falta);
        if (!prevFaltas.length) return;
        // Compensação: mês atual no patamar (ou alto) depois de falta / mês fraco
        const covered = prevFaltas.filter((p) => {
          if (cell.alto) return true;
          if (p.valor <= noise && cell.valor > noise) return true;
          if (baseline > noise && cell.valor >= baseline * 0.7 && cell.valor >= Math.max(p.valor * 2, noise * 10)) {
            return true;
          }
          return false;
        });
        if (!covered.length) return;
        covered.forEach((p) => {
          compensacoes.push({
            faltou: p.label,
            caiuEm: cell.label,
            valorFalta: p.valor,
            valorCaiu: cell.valor
          });
        });
      });

      // Dedup compensações por mês que faltou
      const seenFalta = new Set();
      const comps = compensacoes.filter((x) => {
        if (seenFalta.has(x.faltou)) return false;
        seenFalta.add(x.faltou);
        return true;
      });

      const last = cells[cells.length - 1];
      const everPosted = cells.some((x) => (x.linhas || 0) > 0 || Math.abs(x.valor || 0) > noise);
      const faltasAbertas = faltas.filter((f) => !seenFalta.has(f.label));
      let status = 'em_dia';
      let statusLabel = 'Em dia';
      if (!everPosted) {
        status = 'sem_historico';
        statusLabel = 'Sem lançamento';
      } else if (months.length < 2) {
        status = 'em_dia';
        statusLabel = 'Só 1 mês';
      } else if (last?.falta) {
        status = 'em_atraso';
        statusLabel = 'Em atraso';
      } else if (faltasAbertas.length) {
        status = 'gap_aberto';
        statusLabel = 'Gap aberto';
      } else if (comps.length) {
        status = 'compensado';
        statusLabel = 'Compensado';
      } else if (cells.some((x) => x.alto || x.baixo)) {
        status = 'irregular';
        statusLabel = 'Irregular';
      }

      const leituraParts = [];
      if (!everPosted) {
        leituraParts.push('Contrato no catálogo, mas ainda sem lançamento na KSB1 deste histórico — reenvie o arquivo e clique em Atualizar contratos');
      }
      if (comps.length) {
        comps.forEach((x) => {
          leituraParts.push(`Faltou ${x.faltou} · caiu em ${x.caiuEm} (compensou)`);
        });
      }
      faltasAbertas.forEach((f) => {
        if (f.key === last?.key) leituraParts.push(`Sem lançamento em ${f.label} (atraso)`);
        else leituraParts.push(`Faltou ${f.label} (ainda sem compensação clara)`);
      });
      if (!leituraParts.length && cells.some((x) => x.alto)) {
        const altos = cells.filter((x) => x.alto).map((x) => x.label);
        leituraParts.push(`${altos.join(', ')} acima do típico`);
      }
      if (!leituraParts.length && cells.some((x) => x.baixo)) {
        const baixos = cells.filter((x) => x.baixo).map((x) => x.label);
        leituraParts.push(`${baixos.join(', ')} abaixo do típico`);
      }
      if (!leituraParts.length) leituraParts.push('Lançamentos regulares no histórico');

      return {
        key: c.key,
        contrato: c.contrato,
        area: c.area,
        baseline,
        cells,
        faltas: everPosted ? faltas.map((f) => f.label) : [],
        faltasAbertas: everPosted ? faltasAbertas.map((f) => f.label) : [],
        compensacoes: comps,
        status,
        statusLabel,
        leitura: leituraParts.join(' · '),
        total: cells.reduce((s, x) => s + x.valor, 0),
        ultimoMes: last?.label || '',
        ultimoValor: last?.valor || 0,
        everPosted
      };
    }).sort((a, b) => {
      const ra = statusRank[a.status] ?? 9;
      const rb = statusRank[b.status] ?? 9;
      if (ra !== rb) return ra - rb;
      return Math.abs(b.total) - Math.abs(a.total);
    });

    // Gap agregado por mês (para os cards / faixa abaixo dos KPIs)
    const byMonth = months.map((m, idx) => {
      const faltas = [];
      const compensouNomes = [];
      let valor = 0;
      let linhas = 0;
      contracts.forEach((c) => {
        const cell = (c.cells || []).find((x) => x.key === m.key);
        if (!cell) return;
        valor += cell.valor || 0;
        linhas += cell.linhas || 0;
        // Não conta como gap contratos que nunca tiveram lançamento no histórico
        if (cell.falta && c.everPosted) {
          faltas.push({
            key: c.key,
            contrato: c.contrato,
            area: c.area,
            valor: cell.valor || 0,
            tipico: c.baseline || 0
          });
        }
        (c.compensacoes || []).forEach((comp) => {
          if (comp.caiuEm === (m.label || cell.label)) {
            compensouNomes.push(c.contrato);
          }
        });
      });
      const gapValor = faltas.reduce((s, f) => s + (f.tipico > 0 ? f.tipico : 0), 0);
      return {
        key: m.key,
        label: m.label || monthLabel(m.month, m.year),
        year: m.year,
        month: m.month,
        gaps: faltas.length,
        contratosGap: faltas.map((f) => f.contrato),
        faltas,
        gapValor,
        compensou: compensouNomes.length,
        compensouNomes: [...new Set(compensouNomes)],
        valor,
        linhas,
        isLast: idx === months.length - 1,
        tone: faltas.length ? (idx === months.length - 1 ? 'atraso' : 'gap') : 'ok'
      };
    });

    const lastMonth = byMonth[byMonth.length - 1] || null;
    const prevMonth = byMonth.length >= 2 ? byMonth[byMonth.length - 2] : null;
    const gapContracts = contracts.filter((c) => c.status === 'gap_aberto' || c.status === 'em_atraso');
    const kpis = {
      gap: gapContracts.length,
      emAtraso: contracts.filter((c) => c.status === 'em_atraso').length,
      gaps: gapContracts.length,
      compensados: contracts.filter((c) => c.status === 'compensado').length,
      emDia: contracts.filter((c) => c.status === 'em_dia').length,
      total: contracts.length,
      variacao: {
        mes: lastMonth?.label || '',
        mesPrev: prevMonth?.label || '',
        gaps: lastMonth?.gaps ?? 0,
        gapsPrev: prevMonth != null ? prevMonth.gaps : null,
        deltaGaps: prevMonth != null ? lastMonth.gaps - prevMonth.gaps : null,
        gapValor: lastMonth?.gapValor ?? 0,
        gapValorPrev: prevMonth != null ? prevMonth.gapValor : null,
        deltaValor: prevMonth != null ? lastMonth.gapValor - prevMonth.gapValor : null
      }
    };

    return {
      months,
      contracts,
      byMonth,
      kpis,
      ready: months.length >= 2,
      hint: months.length < 2
        ? 'Envie pelo menos 2 meses de KSB1 para detectar gap e compensação.'
        : `Linha do tempo: ${months.map((m) => m.label).join(' → ')}`
    };
  }

  return {
    CONTRACT_AREAS,
    MONITORED_KEYS,
    MONTH_LABELS,
    slotKey,
    parseSlotKey,
    monthLabel,
    detectPeriod,
    listPeriodsInRows,
    tagRowsWithOwnPeriod,
    tagRowsWithPeriod,
    groupRowsByMonth,
    parseFile,
    parseFiles,
    filterRows,
    summary,
    rankFornecedores,
    rankAreas,
    uniqueValues,
    formatMoney,
    formatMoneyCompact,
    inferContract,
    isMonitoredRow,
    reclassifyRows,
    analyzeTimeline,
    aggregateRelatorioAct,
    normCcKey
  };
})();
