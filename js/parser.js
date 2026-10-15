/* Parser de planilhas Relatorio (xlsx/csv) → linhas normalizadas + anos PY */
const Parser = (() => {
  const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const MONTH_ALIASES = {
    jan: 'jan', janeiro: 'jan', '01': 'jan', 1: 'jan',
    fev: 'fev', fevereiro: 'fev', '02': 'fev', 2: 'fev',
    mar: 'mar', março: 'mar', marco: 'mar', '03': 'mar', 3: 'mar',
    abr: 'abr', abril: 'abr', '04': 'abr', 4: 'abr',
    mai: 'mai', maio: 'mai', '05': 'mai', 5: 'mai',
    jun: 'jun', junho: 'jun', '06': 'jun', 6: 'jun',
    jul: 'jul', julho: 'jul', '07': 'jul', 7: 'jul',
    ago: 'ago', agosto: 'ago', '08': 'ago', 8: 'ago',
    set: 'set', setembro: 'set', '09': 'set', 9: 'set',
    out: 'out', outubro: 'out', '10': 'out', 10: 'out',
    nov: 'nov', novembro: 'nov', '11': 'nov', 11: 'nov',
    dez: 'dez', dezembro: 'dez', '12': 'dez', 12: 'dez'
  };

  function norm(s) {
    return String(s ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function toNumber(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v * 100) / 100;
    let t = String(v).trim().replace(/\s/g, '');
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) {
      t = t.replace(/\./g, '').replace(',', '.');
    } else if (t.includes(',') && !t.includes('.')) {
      t = t.replace(',', '.');
    }
    const n = Number(t);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
  }

  function emptyMonths() {
    return Object.fromEntries(MONTHS.map((m) => [m, 0]));
  }

  function findSheet(workbook) {
    const names = workbook.SheetNames || [];
    // Preferência: aba chamada Relatorio; se o arquivo tiver só 1 aba (export isolado), usa ela
    const preferred = names.find((n) => norm(n) === 'relatorio')
      || names.find((n) => norm(n).includes('relatorio'))
      || (names.length === 1 ? names[0] : null);
    if (!preferred) {
      throw new Error('Aba Relatorio não encontrada. Exporte só a aba Relatorio (ou envie o .xlsx com essa aba).');
    }
    return workbook.Sheets[preferred];
  }

  function readWorkbookBuffer(arrayBuffer) {
    // cellStyles: lê metadados de linha/coluna oculta (filtro, grupo) — mas NÃO pulamos essas linhas
    return XLSX.read(arrayBuffer, {
      type: 'array',
      cellDates: false,
      cellStyles: true,
      sheetStubs: true
    });
  }

  /**
   * Converte a aba em matriz AOA lendo TODAS as linhas/colunas do intervalo usado,
   * inclusive ocultas, filtradas ou agrupadas no Excel.
   */
  function sheetToMatrix(sheet) {
    if (!sheet) return { matrix: [], stats: { sheetRows: 0, sheetCols: 0, hiddenRows: 0 } };

    const ref = sheet['!ref'] || 'A1';
    const range = XLSX.utils.decode_range(ref);
    const rowInfo = sheet['!rows'] || [];
    const colInfo = sheet['!cols'] || [];
    let hiddenRows = 0;
    let hiddenCols = 0;

    for (let r = range.s.r; r <= range.e.r; r++) {
      if (rowInfo[r]?.hidden) hiddenRows += 1;
    }
    for (let c = range.s.c; c <= range.e.c; c++) {
      if (colInfo[c]?.hidden) hiddenCols += 1;
    }

    // skipHidden: false = nunca omitir linha/coluna oculta (filtro AutoFilter, grupo, hide)
    const matrix = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
      raw: true,
      blankrows: true,
      skipHidden: false,
      range
    });

    // Garante índice contínuo até a última linha do !ref (linhas totalmente vazias no meio)
    const height = range.e.r - range.s.r + 1;
    const width = range.e.c - range.s.c + 1;
    while (matrix.length < height) matrix.push([]);
    for (let i = 0; i < matrix.length; i++) {
      const row = matrix[i] || (matrix[i] = []);
      while (row.length < width) row.push('');
    }

    return {
      matrix,
      stats: {
        sheetRows: height,
        sheetCols: width,
        hiddenRows,
        hiddenCols,
        matrixRows: matrix.length
      }
    };
  }

  function scoreHeaderRow(row) {
    const joined = row.map(norm).join('|');
    let score = 0;
    if (joined.includes('unidade')) score += 3;
    if (joined.includes('setor')) score += 2;
    if (joined.includes('centro')) score += 2;
    if (joined.includes('conta')) score += 2;
    if (joined.includes('bud') || joined.includes('fc1') || joined.includes('act') || joined.includes('py ')) score += 2;
    return score;
  }

  function detectMonthToken(h) {
    return Object.keys(MONTH_ALIASES).find((k) => {
      const re = new RegExp(`(?:^|\\s)${k}(?:\\s|$)`);
      return re.test(h) || h === k;
    });
  }

  function mapPyBlocks(header, currentYear = 2026) {
    const blocks = [];
    let pending = {};
    let blockIndex = 0;

    function flush(year) {
      if (!Object.keys(pending).length) return;
      blocks.push({
        year: Number(year) || (Number(currentYear) - 2 + blockIndex),
        months: pending
      });
      blockIndex += 1;
      pending = {};
    }

    header.forEach((raw, idx) => {
      const h = norm(raw);
      if (!h) return;

      // Fecha bloco: "PY FY 2024", "FY 2024" ou só "2024" (2ª linha de cabeçalho)
      const fy = h.match(/^(?:py\s+)?fy\s*(\d{4})$/) || (/^(\d{4})$/.test(h) ? h.match(/^(\d{4})$/) : null);
      if (fy && Object.keys(pending).length && !h.startsWith('act') && !h.startsWith('bud') && !h.startsWith('fc')) {
        flush(Number(fy[1]));
        return;
      }

      if (!h.startsWith('py') || h.includes('fy')) return;
      const monthHit = detectMonthToken(h);
      if (monthHit) pending[MONTH_ALIASES[monthHit]] = idx;
    });
    flush(Number(currentYear) - 2 + blockIndex);
    return blocks;
  }

  function mapColumns(header) {
    const map = {
      unidade: -1,
      setor: -1,
      grupo: -1,
      cc: -1,
      tipo: -1,
      comentario: -1,
      conta: -1,
      contaDesc: -1,
      ccNome: -1,
      bud: {},
      fc1: {},
      fc2: {},
      fc3: {},
      act: {},
      pyBlocks: [],
      currentYear: 2026
    };

    header.forEach((raw, idx) => {
      const h = norm(raw);
      if (!h) return;

      if (map.unidade < 0 && h === 'unidade') map.unidade = idx;
      else if (map.setor < 0 && h === 'setor') map.setor = idx;
      else if (map.grupo < 0 && (h.includes('grupo de conta') || h === 'grupo')) map.grupo = idx;
      else if (map.cc < 0 && (h === 'centro de custo' || h === 'cod/centro de custo' || h === 'cost center')) map.cc = idx;
      else if (map.tipo < 0 && (h === 'tipo de conta' || h === 'tipo')) map.tipo = idx;
      else if (map.comentario < 0 && h.includes('comentario')) map.comentario = idx;
      else if (map.conta < 0 && (h === 'conta contabil' || h === 'conta contábil' || h === 'cost element')) map.conta = idx;
      else if (map.contaDesc < 0 && (h.includes('descricao conta') || h.includes('cost element name'))) map.contaDesc = idx;
      else if (map.ccNome < 0 && (h.includes('descricao centro') || h === 'co object name')) map.ccNome = idx;

      const actFy = h.match(/act\s*fy\s*(\d{4})/);
      if (actFy) map.currentYear = Number(actFy[1]);
    });

    header.forEach((raw, idx) => {
      const h = norm(raw);
      if (!h || h.startsWith('py')) return;

      const monthHit = detectMonthToken(h);
      const month = monthHit ? MONTH_ALIASES[monthHit] : null;
      if (!month) return;

      if (h.startsWith('bud') || h.includes('budget')) map.bud[month] = idx;
      else if (h.startsWith('fc1') || h.includes('fc 1')) map.fc1[month] = idx;
      else if (h.startsWith('fc2') || h.includes('fc 2')) map.fc2[month] = idx;
      else if (h.startsWith('fc3') || h.includes('fc 3')) map.fc3[month] = idx;
      else if (h.startsWith('act') || h.includes('realizado') || h.includes('actual')) map.act[month] = idx;
    });

    // colunas "Jan" soltas entre FC2 FY e ACT = FC3
    let seenFc2Fy = false;
    let seenAct = false;
    header.forEach((raw, idx) => {
      const h = norm(raw);
      if (h.includes('fc') && h.includes('fy') && Object.keys(map.fc2).length) seenFc2Fy = true;
      if (h.startsWith('act')) seenAct = true;
      if (!seenFc2Fy || seenAct) return;
      const monthHit = detectMonthToken(h);
      if (!monthHit) return;
      const month = MONTH_ALIASES[monthHit];
      if (map.fc3[month] == null && (h === monthHit || h === month || /^[a-z]{3}$/.test(h))) {
        map.fc3[month] = idx;
      }
    });

    map.pyBlocks = mapPyBlocks(header, map.currentYear);

    // fallback posicional do layout Relatorio Bayer (0-based)
    if (map.unidade < 0) map.unidade = 2;
    if (map.setor < 0) map.setor = 3;
    if (map.grupo < 0) map.grupo = 4;
    if (map.cc < 0) map.cc = 5;
    if (map.tipo < 0) map.tipo = 6;
    if (map.comentario < 0) map.comentario = 7;
    if (map.conta < 0) map.conta = 9;
    if (map.contaDesc < 0) map.contaDesc = 10;
    if (map.ccNome < 0) map.ccNome = 14;

    const positional = {
      bud: 41,
      fc1: 54,
      fc2: 67,
      fc3: 80,
      act: 93
    };
    for (const [scenario, start] of Object.entries(positional)) {
      MONTHS.forEach((m, i) => {
        if (map[scenario][m] == null) map[scenario][m] = start + i;
      });
    }

    if (!map.pyBlocks.length) {
      const py2024 = {};
      const py2025 = {};
      MONTHS.forEach((m, i) => {
        py2024[m] = 15 + i;
        py2025[m] = 28 + i;
      });
      map.pyBlocks = [
        { year: 2024, months: py2024 },
        { year: 2025, months: py2025 }
      ];
    }

    return map;
  }

  function pickMonths(row, colMap) {
    const out = emptyMonths();
    MONTHS.forEach((m) => {
      const idx = colMap[m];
      if (idx != null && idx >= 0) out[m] = toNumber(row[idx]);
    });
    return out;
  }

  function extractCc(raw) {
    const s = String(raw ?? '').trim();
    const m = s.match(/MW\d+[A-Z0-9]*/i);
    return m ? m[0].toUpperCase() : s;
  }

  function buildRowBase(row, map) {
    const unidade = String(row[map.unidade] ?? '').trim();
    const ccRaw = String(row[map.cc] ?? '').trim();
    if (!unidade || /unidade/i.test(unidade)) return null;
    const cc = extractCc(ccRaw);
    if (!cc || !/^MW/i.test(cc)) return null;
    return {
      unidade,
      setor: String(row[map.setor] ?? '').trim(),
      grupo: String(row[map.grupo] ?? '').trim(),
      cc,
      ccNome: String(row[map.ccNome] ?? '').trim(),
      tipo: String(row[map.tipo] ?? '').trim(),
      comentario: String(row[map.comentario] ?? '').trim(),
      conta: String(row[map.conta] ?? '').trim(),
      contaDesc: String(row[map.contaDesc] ?? '').trim()
    };
  }

  function rowsFromMatrix(matrix) {
    const parsed = parseMatrixAllYears(matrix);
    return parsed.years[parsed.currentYear] || [];
  }

  function parseMatrixAllYears(matrix) {
    if (!matrix?.length) {
      return { currentYear: 2026, years: {} };
    }

    let headerIdx = 0;
    let best = -1;
    for (let i = 0; i < Math.min(8, matrix.length); i++) {
      const score = scoreHeaderRow((matrix[i] || []).map((c) => String(c ?? '')));
      if (score > best) {
        best = score;
        headerIdx = i;
      }
    }

    const header = (matrix[headerIdx] || []).map((c) => String(c ?? ''));
    const map = mapColumns(header);
    const years = {};
    const currentYear = map.currentYear || 2026;
    years[currentYear] = [];

    map.pyBlocks.forEach((b) => {
      years[b.year] = [];
    });

    for (let r = headerIdx + 1; r < matrix.length; r++) {
      const row = matrix[r] || [];
      const base = buildRowBase(row, map);
      if (!base) continue;

      const bud = pickMonths(row, map.bud);
      const fc1 = pickMonths(row, map.fc1);
      const fc2 = pickMonths(row, map.fc2);
      const fc3 = pickMonths(row, map.fc3);
      const act = pickMonths(row, map.act);

      years[currentYear].push({
        ...base,
        year: currentYear,
        bud,
        fc1,
        fc2,
        fc3,
        act
      });

      map.pyBlocks.forEach((block) => {
        const py = pickMonths(row, block.months);
        const hasValue = MONTHS.some((m) => (py[m] || 0) !== 0);
        if (!hasValue) return;
        // Anos anteriores: só o realizado PY. O previsto (YoY) é montado no app.js.
        years[block.year].push({
          ...base,
          year: block.year,
          bud: emptyMonths(),
          fc1: emptyMonths(),
          fc2: emptyMonths(),
          fc3: emptyMonths(),
          act: { ...py },
          source: 'py'
        });
      });
    }

    return { currentYear, years, headerIdx };
  }

  function parseWorkbook(arrayBuffer) {
    const workbook = readWorkbookBuffer(arrayBuffer);
    const sheet = findSheet(workbook);
    const { matrix } = sheetToMatrix(sheet);
    return rowsFromMatrix(matrix);
  }

  function parseWorkbookAllYears(arrayBuffer) {
    const workbook = readWorkbookBuffer(arrayBuffer);
    const sheet = findSheet(workbook);
    const { matrix, stats } = sheetToMatrix(sheet);
    const parsed = parseMatrixAllYears(matrix);
    parsed.sheetStats = stats;
    return parsed;
  }

  function parseCsvText(text) {
    const workbook = XLSX.read(text, { type: 'string' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
      raw: false,
      blankrows: true,
      skipHidden: false
    });
    return rowsFromMatrix(matrix);
  }

  function parseCsvAllYears(text) {
    const workbook = XLSX.read(text, { type: 'string' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
      raw: false,
      blankrows: true,
      skipHidden: false
    });
    const parsed = parseMatrixAllYears(matrix);
    parsed.sheetStats = {
      sheetRows: matrix.length,
      sheetCols: matrix[0]?.length || 0,
      hiddenRows: 0,
      hiddenCols: 0,
      matrixRows: matrix.length
    };
    return parsed;
  }

  function findActionsSheet(workbook) {
    const names = workbook.SheetNames || [];
    const hit = names.find((n) => {
      const x = norm(n);
      return x === 'acoes' || x.includes('acao') || x === 'actions';
    });
    return hit ? workbook.Sheets[hit] : null;
  }

  function parseActionsMatrix(matrix) {
    if (!matrix?.length) return [];
    let headerRow = -1;
    let map = {};
    for (let r = 0; r < Math.min(8, matrix.length); r++) {
      const row = matrix[r] || [];
      const labels = row.map((c) => norm(c));
      const mesIdx = labels.findIndex((c) => c === 'mes' || c.startsWith('mes'));
      const setorIdx = labels.findIndex((c) => c.includes('setor'));
      const comIdx = labels.findIndex((c) => c.includes('coment'));
      const quemIdx = labels.findIndex((c) => c === 'quem' || c.includes('respons'));
      if (mesIdx >= 0 && (comIdx >= 0 || quemIdx >= 0)) {
        headerRow = r;
        map = {
          mes: mesIdx,
          setor: setorIdx,
          comentario: comIdx,
          quem: quemIdx,
          prazo: labels.findIndex((c) => c.includes('prazo')),
          concluido: labels.findIndex((c) => c.includes('conclu'))
        };
        break;
      }
    }
    if (headerRow < 0) return [];

    const monthNumToKey = {
      1: 'jan', 2: 'fev', 3: 'mar', 4: 'abr', 5: 'mai', 6: 'jun',
      7: 'jul', 8: 'ago', 9: 'set', 10: 'out', 11: 'nov', 12: 'dez'
    };
    const out = [];
    for (let r = headerRow + 1; r < matrix.length; r++) {
      const row = matrix[r] || [];
      const comentario = String(row[map.comentario] ?? '').trim();
      const quemRaw = String(row[map.quem] ?? '').trim();
      if (!comentario && !quemRaw) continue;
      const mesCell = row[map.mes];
      let mesNumero = null;
      let mes = '';
      if (typeof mesCell === 'number') {
        mesNumero = mesCell;
        mes = monthNumToKey[mesCell] || String(mesCell);
      } else {
        const t = String(mesCell || '').trim();
        if (/^\d+$/.test(t)) {
          mesNumero = Number(t);
          mes = monthNumToKey[mesNumero] || t;
        } else {
          mes = MONTH_ALIASES[norm(t)] || norm(t);
        }
      }
      const conc = norm(row[map.concluido]);
      out.push({
        id: `import_${out.length + 1}`,
        mes,
        mesNumero,
        setor: String(row[map.setor] ?? '').trim(),
        comentario,
        quem: String(quemRaw || '')
          .split(/\s*\/\s*|\s*,\s*/)
          .map((p) => p.trim())
          .filter(Boolean),
        prazo: String(row[map.prazo] ?? '').trim(),
        concluido: conc === 'sim' || conc === 'yes' || conc === 'x' || conc === 'true',
        source: 'import',
        quemExtra: []
      });
    }
    return out;
  }

  function parseActionsFromWorkbook(arrayBuffer) {
    const workbook = readWorkbookBuffer(arrayBuffer);
    const sheet = findActionsSheet(workbook);
    if (!sheet) return [];
    const { matrix } = sheetToMatrix(sheet);
    return parseActionsMatrix(matrix);
  }

  async function parseFile(file) {
    const name = file.name || 'arquivo';
    const lower = name.toLowerCase();
    if (lower.endsWith('.csv')) {
      const text = await file.text();
      const all = parseCsvAllYears(text);
      return {
        fileName: name,
        rows: all.years[all.currentYear] || [],
        years: all.years,
        currentYear: all.currentYear,
        sheetStats: all.sheetStats || null,
        actions: []
      };
    }
    const buffer = await file.arrayBuffer();
    const all = parseWorkbookAllYears(buffer);
    let actions = [];
    try {
      actions = parseActionsFromWorkbook(buffer);
    } catch (_) {
      actions = [];
    }
    return {
      fileName: name,
      rows: all.years[all.currentYear] || [],
      years: all.years,
      currentYear: all.currentYear,
      sheetStats: all.sheetStats || null,
      actions
    };
  }

  /**
   * Mescla planilhas dos 4 slots.
   * Cada slot atualiza o cenário correspondente; ACT vem do slot mais recente com ACT preenchido.
   */
  function mergeSlots(slotMap, seedRows) {
    const byKey = new Map();

    function keyOf(r) {
      return `${r.cc}||${r.conta}||${r.tipo}||${r.unidade}||${r.setor}`;
    }

    function ensure(row) {
      const k = keyOf(row);
      if (!byKey.has(k)) {
        byKey.set(k, {
          ...row,
          bud: { ...emptyMonths(), ...(row.bud || {}) },
          fc1: { ...emptyMonths(), ...(row.fc1 || {}) },
          fc2: { ...emptyMonths(), ...(row.fc2 || {}) },
          fc3: { ...emptyMonths(), ...(row.fc3 || {}) },
          act: { ...emptyMonths(), ...(row.act || {}) }
        });
      }
      return byKey.get(k);
    }

    (seedRows || []).forEach((r) => ensure(r));

    const order = ['budget', 'fc1', 'fc2', 'fc3'];
    order.forEach((slot) => {
      const pack = slotMap[slot];
      if (!pack?.rows?.length) return;
      pack.rows.forEach((r) => {
        const target = ensure(r);
        if (slot === 'budget') target.bud = { ...emptyMonths(), ...r.bud };
        if (slot === 'fc1') target.fc1 = { ...emptyMonths(), ...(r.fc1 || r.bud || {}) };
        if (slot === 'fc2') target.fc2 = { ...emptyMonths(), ...(r.fc2 || r.bud || {}) };
        if (slot === 'fc3') target.fc3 = { ...emptyMonths(), ...(r.fc3 || r.bud || {}) };

        // se a planilha trouxe ACT, atualiza
        const actSum = MONTHS.reduce((s, m) => s + (r.act?.[m] || 0), 0);
        if (actSum !== 0) target.act = { ...emptyMonths(), ...r.act };

        // metadados textuais preferem o mais recente
        target.unidade = r.unidade || target.unidade;
        target.setor = r.setor || target.setor;
        target.ccNome = r.ccNome || target.ccNome;
        target.comentario = r.comentario || target.comentario;
        target.tipo = r.tipo || target.tipo;
        target.contaDesc = r.contaDesc || target.contaDesc;
      });
    });

    return Array.from(byKey.values());
  }

  return {
    MONTHS,
    parseFile,
    mergeSlots,
    emptyMonths,
    parseActionsFromWorkbook,
    parseWorkbookAllYears,
    parseCsvAllYears
  };
})();
