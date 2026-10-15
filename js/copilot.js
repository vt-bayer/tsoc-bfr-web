/* Ajudante do app — explica abas/recursos e responde com base nos dados/filtros atuais */
const CopilotAgent = (() => {
  let getContext = () => ({ rows: [], filters: {}, meta: {}, year: 2026 });

  function setContextProvider(fn) {
    getContext = fn;
  }

  function norm(s) {
    return String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  function tokens(s) {
    return norm(s)
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !STOP.has(t));
  }

  const STOP = new Set([
    'que', 'qual', 'quais', 'como', 'onde', 'quando', 'quanto', 'quanta', 'quantos', 'quantas',
    'para', 'por', 'com', 'sem', 'uma', 'uns', 'umas', 'dos', 'das', 'nos', 'nas', 'pelo', 'pela',
    'este', 'esta', 'esse', 'essa', 'isto', 'aqui', 'ali', 'mais', 'menos', 'muito', 'muita',
    'sobre', 'dentro', 'app', 'me', 'fala', 'diga', 'mostra', 'mostre', 'listar', 'liste',
    'tem', 'ter', 'hao', 'há', 'sao', 'são', 'esta', 'está', 'foi', 'ser', 'seu', 'sua',
    'ano', 'mes', 'mês', 'pelo', 'pode', 'poder', 'quero', 'saber', 'ver', 'veja'
  ]);

  function extractCc(q) {
    const m = String(q).toUpperCase().match(/MW\d+[A-Z0-9]*/);
    return m ? m[0] : null;
  }

  function currentSummary(ctx) {
    const filters = ctx.filters || UI.readFilters();
    const ccList = Engine.aggregateCostCenters(ctx.rows || [], filters);
    const sum = Engine.summary(ccList, filters);
    const ranking = Engine.sortAttention(ccList);
    return { filters, ccList, sum, ranking };
  }

  function scopeLine(ctx, filters) {
    return `Ano **${ctx.year || 2026}** · vs **${Engine.SCENARIO_LABELS[filters.scenario]}** · ${filters.periodo === 'ytd' ? 'acumulado até' : 'mês'} **${Engine.MONTH_LABELS[filters.mes]}**.`;
  }

  function hasRows(ctx) {
    return (ctx.rows || []).length > 0;
  }

  /* —— Guias do app (não dependem de dados) —— */

  function answerHelp() {
    return [
      'Sou o **ajudante do TSOC BFR** — ajudo a usar o app e a ler o que está na tela.',
      '',
      '**Sobre o app**',
      '• “O que tem neste app?” / “Quais abas existem?”',
      '• “O que faz a aba Detalhes / Contratos / DAX / Admin?”',
      '• “Como filtrar?” / “O que significa FC2 / YTD / gap?”',
      '',
      '**Sobre os números (filtros atuais)**',
      '• “Qual o resumo atual?” / “Quanto é o realizado?”',
      '• “Quais centros estão acima do previsto?”',
      '• “Me fala do MW09C20208” ou do nome do centro / unidade',
      '',
      'Mude **Ano**, cenário ou unidade em Detalhes e pergunte de novo — a resposta usa o recorte atual.'
    ].join('\n');
  }

  function answerAppOverview() {
    return [
      '**TSOC BFR 2026** compara **realizado** vs **previsto** (Budget / FC1–FC3) dos centros de custo de Belford Roxo.',
      '',
      'Abas no menu:',
      '1. **Resumo executivo** — visão rápida (KPIs e panorama)',
      '2. **Detalhes & ranking** — filtros, ranking e detalhe do centro',
      '3. **DAX / regras** — como o cálculo funciona (espelho Power BI)',
      '4. **Contratos** — gap/atraso/compensação dos contratos KSB1',
      '5. **Administrador** — upload da planilha e pessoas autorizadas (só CBAIS, GPGMS, GPUST)',
      '',
      'Valores do Relatorio vêm em milhares (**k**). Em Contratos, valores são em **BRL**.'
    ].join('\n');
  }

  function answerTabInicio() {
    return [
      'Aba **Resumo executivo**:',
      '• Snapshot rápido: unidades, centros, realizado, previsto e diferença',
      '• Frase em linguagem natural do status atual',
      '• Atalhos para Detalhes, DAX, Contratos e Admin',
      '',
      'Para filtrar por unidade/setor/mês, vá em **Detalhes & ranking**.'
    ].join('\n');
  }

  function answerTabDetalhes() {
    return [
      'Aba **Detalhes & ranking** — análise operacional:',
      '1. **Ano** — base carregada (uploads por ano no Admin)',
      '2. **Unidade** → **Setor**',
      '3. **Comparar com** → Budget, FC1, FC2 ou FC3',
      '4. **Período** (mês único ou **YTD** acumulado) + **Mês**',
      '5. **Categoria** (tipo de conta) e busca por centro',
      '',
      'KPIs, frase e ranking atualizam juntos. Clique em **Ver detalhe** para a tela cheia do centro.',
      'Dá para baixar o recorte (download) pelo botão da própria aba.'
    ].join('\n');
  }

  function answerTabDax() {
    return [
      'Aba **DAX / regras** documenta as regras de negócio no formato Power BI:',
      '• Como monta **Realizado** (ACT / PY)',
      '• Como monta **Previsto** (cenário escolhido)',
      '• **Diferença** = Realizado − Previsto e a situação (economia / estável / estouro)',
      '• Período mês vs **YTD**',
      '• Meses sem ACT não viram “economia” falsa',
      '',
      'É referência para quem replica o modelo no Power BI — os números do app já seguem essas regras.'
    ].join('\n');
  }

  function answerTabContratos() {
    return [
      'Aba **Contratos** acompanha contratos de site (logística, infra, segurança, saúde):',
      '• **Gap** — o que faltou no mês',
      '• **Compensados** — faltou e caiu depois',
      '• Mapa de calor mês a mês (Falta / Compensou / Normal)',
      '• Linha do tempo por contrato',
      '',
      'O arquivo **KSB1** (site, ex.: Belford Roxo_Set) é enviado em **Administrador** → Contratos (KSB1) → **Atualizar contratos**.',
      'A coluna **Period** define o mês. Valores em **BRL** (não em k).'
    ].join('\n');
  }

  function answerHowToFilter() {
    return [
      'Na aba **Detalhes & ranking**, filtros do topo:',
      '1. **Ano** — troca a base',
      '2. **Unidade** → **Setor**',
      '3. **Comparar com** → Budget, FC1, FC2 ou FC3',
      '4. **Período** (mês ou acumulado) + **Mês**',
      '5. **Categoria** e busca por centro',
      '',
      'Tudo na tela (KPIs, ranking, detalhe) usa esse recorte. Pergunte depois: “resumo atual” ou “centros acima”.'
    ].join('\n');
  }

  function answerScenarios() {
    return [
      '**Cenários de comparação** (filtro “Comparar com”)',
      '• **Budget** — orçamento do ano',
      '• **FC1 / FC2 / FC3** — forecasts revisados ao longo do ano',
      '• **Realizado (ACT)** — gasto efetivo no ano corrente',
      '• **PY** — ano anterior (quando o ano selecionado é histórico)',
      '',
      '**Diferença** = Realizado − Previsto do cenário.',
      'Verde = economia · Vermelho = estouro · Cinza = estável (±1%).',
      'No Relatorio, valores em milhares (**k**).'
    ].join('\n');
  }

  function answerGlossary(term) {
    const map = {
      ytd: [
        '**YTD** (year to date) = acumulado do ano **até o mês** escolhido no filtro.',
        'No modo **mês**, o app olha só aquele mês.'
      ].join('\n'),
      k: [
        '**k** = milhares. Ex.: 1.250 k ≈ R$ 1.250.000 na planilha Relatorio.',
        'Na aba Contratos os valores são em **BRL** (reais), não em k.'
      ].join('\n'),
      gap: [
        '**Gap** (Contratos) = contrato que **faltou** no mês comparado ao histórico.',
        '**Compensado** = faltou e depois apareceu. **Em atraso** = ainda falta no último mês.'
      ].join('\n'),
      ksb1: [
        '**KSB1** é o extrato mensal de contratos do site (ex.: Belford Roxo_Set).',
        'Envie no **Administrador** e clique em **Atualizar contratos**. A leitura aparece na aba **Contratos**.'
      ].join('\n'),
      cc: [
        '**Centro de custo (CC)** — código tipo **MW…** com unidade, setor e tipos de conta.',
        'Pergunte o código (ex.: MW09C20208) ou o nome para eu resumir realizado vs previsto.'
      ].join('\n'),
      act: [
        '**ACT** = realizado do ano corrente na aba Relatorio.',
        'Em anos históricos o app usa **PY** (prior year) no lugar do ACT.'
      ].join('\n')
    };
    if (term && map[term]) return map[term];
    return [
      answerScenarios(),
      '',
      'Outros termos: **YTD**, **k**, **gap**, **KSB1**, **CC**, **ACT**. Pergunte “o que é YTD?” etc.'
    ].join('\n');
  }

  function answerAdmin() {
    return [
      'Aba **Administrador** (acesso só: **CBAIS** Vitor, **GPGMS** Francielle, **GPUST** Pamela):',
      '',
      '• Enviar Excel com aba **Relatorio** (Budget / FC1 / FC2 / FC3 por ano)',
      '• Enviar **KSB1** e atualizar contratos',
      '• Incluir / excluir pessoas autorizadas ao Admin',
      '',
      'Demais abas (Overview, FAM…) do Excel não são necessárias para o Relatorio.'
    ].join('\n');
  }

  function answerUpload() {
    return [
      'Para atualizar custos:',
      '1. No Excel TSOC BFR, abra a aba **Relatorio**',
      '2. Exporte/salve o .xlsx (filtros/ocultas podem ficar)',
      '3. Em **Administrador**, envie no cartão do forecast (Budget/FC1/FC2/FC3)',
      '',
      'Para contratos: envie o **KSB1** no mesmo Admin e clique **Atualizar contratos**.',
      'Só CWIDs autorizados entram no Admin.'
    ].join('\n');
  }

  /* —— Respostas com dados —— */

  function answerSummary(ctx) {
    const { filters, sum, ranking } = currentSummary(ctx);
    const top = ranking.slice(0, 3);
    const lines = [
      Engine.naturalSummary(sum),
      '',
      scopeLine(ctx, filters)
    ];
    if (filters.unidade) lines.push(`Unidade filtrada: **${filters.unidade}**.`);
    if (filters.setor) lines.push(`Setor filtrado: **${filters.setor}**.`);
    if (top.length) {
      lines.push('', 'Maiores desvios agora:');
      top.forEach((c, i) => {
        lines.push(`${i + 1}. **${c.cc}** (${c.unidade} / ${c.setor}) → ${Engine.formatK(c.diff, { signed: true })} · ${c.situacao.label}`);
      });
    }
    return lines.join('\n');
  }

  function answerTotals(ctx, focus) {
    const { filters, sum } = currentSummary(ctx);
    const lines = [
      `Números do filtro atual (${scopeLine(ctx, filters)}):`,
      '',
      `• **Realizado:** ${Engine.formatK(sum.realizado)}`,
      `• **Previsto (${Engine.SCENARIO_LABELS[filters.scenario]}):** ${Engine.formatK(sum.previsto)}`,
      `• **Diferença:** ${Engine.formatK(sum.diff, { signed: true })} · ${sum.situacao.label}`,
      `• **Centros:** ${sum.ccs} · **acima do previsto:** ${sum.acima}`
    ];
    if (focus === 'realizado') {
      return `O **realizado** no filtro atual é **${Engine.formatK(sum.realizado)}**.\n\n${scopeLine(ctx, filters)}\nCentros: ${sum.ccs}.`;
    }
    if (focus === 'previsto') {
      return `O **previsto** (${Engine.SCENARIO_LABELS[filters.scenario]}) é **${Engine.formatK(sum.previsto)}**.\n\n${scopeLine(ctx, filters)}`;
    }
    if (focus === 'diferenca') {
      return `A **diferença** (realizado − previsto) é **${Engine.formatK(sum.diff, { signed: true })}** (${sum.situacao.label}).\n\n${scopeLine(ctx, filters)}`;
    }
    return lines.join('\n');
  }

  function answerCounts(ctx) {
    const meta = ctx.meta || Engine.metaFromRows(ctx.rows || []);
    const { filters, sum, ccList } = currentSummary(ctx);
    const setores = new Set(ccList.map((c) => c.setor).filter(Boolean));
    return [
      `No filtro atual (${scopeLine(ctx, filters)}):`,
      `• **${sum.ccs}** centros de custo`,
      `• **${setores.size}** setores no recorte`,
      `• **${(meta.unidades || []).length}** unidades na base do ano`,
      `• **${(meta.tipos || []).length}** tipos de conta`,
      '',
      'Unidades: ' + ((meta.unidades || []).slice(0, 12).join(', ') || '—')
        + ((meta.unidades || []).length > 12 ? '…' : '')
    ].join('\n');
  }

  function answerOverruns(ctx) {
    const { ranking, sum, filters } = currentSummary(ctx);
    const above = ranking.filter((c) => c.diff > 0 && c.situacao.key === 'estouro');
    if (!above.length) {
      return `Nenhum centro acima do previsto no filtro atual (vs ${Engine.SCENARIO_LABELS[filters.scenario]}). Total: ${sum.ccs} centros.`;
    }
    const lines = [
      `Há **${above.length}** centro(s) acima do previsto vs **${Engine.SCENARIO_LABELS[filters.scenario]}**:`,
      ''
    ];
    above.slice(0, 8).forEach((c, i) => {
      lines.push(`${i + 1}. **${c.cc}** — ${c.ccNome || ''} · ${c.unidade} / ${c.setor}`);
      lines.push(`   Realizado ${Engine.formatK(c.realizado)} · Previsto ${Engine.formatK(c.previsto)} · Diferença ${Engine.formatK(c.diff, { signed: true })}`);
    });
    if (above.length > 8) lines.push('', `…e mais ${above.length - 8}.`);
    return lines.join('\n');
  }

  function answerSavings(ctx) {
    const { ranking, filters } = currentSummary(ctx);
    const eco = ranking.filter((c) => c.diff < 0 && c.situacao.key === 'economia');
    if (!eco.length) return 'Não há centros com economia relevante no filtro atual.';
    const lines = [`Maiores economias vs **${Engine.SCENARIO_LABELS[filters.scenario]}**:`, ''];
    eco.slice(0, 5).forEach((c, i) => {
      lines.push(`${i + 1}. **${c.cc}** (${c.unidade}) → ${Engine.formatK(c.diff, { signed: true })}`);
    });
    return lines.join('\n');
  }

  function answerCc(ctx, ccCode) {
    const baseFilters = ctx.filters || UI.readFilters();
    const filters = { ...baseFilters, busca: String(ccCode).toLowerCase() };
    const list = Engine.aggregateCostCenters(ctx.rows || [], filters);
    const detail = list.find((x) => x.cc === ccCode) || list[0];
    if (!detail) return `Não encontrei o centro **${ccCode}** com os filtros atuais.`;
    const accounts = Engine.accountImpact(detail, filters);
    const comments = Engine.commentsByTipo(detail, filters);
    const lines = [
      `**${detail.cc} — ${detail.ccNome || 'Centro de custo'}**`,
      `Unidade: ${detail.unidade} · Setor: ${detail.setor}`,
      `Realizado: ${Engine.formatK(detail.realizado)} · Previsto (${Engine.SCENARIO_LABELS[filters.scenario]}): ${Engine.formatK(detail.previsto)}`,
      `Diferença: ${Engine.formatK(detail.diff, { signed: true })} · ${detail.situacao.label}`,
      '',
      Engine.explainCc(detail, accounts, filters)
    ];
    if (comments.length) {
      lines.push('', 'Principais comentários (tipo de conta):');
      comments.slice(0, 5).forEach((c) => {
        lines.push(`• **${c.tipo}** / ${c.comentario} → ${Engine.formatK(c.diff, { signed: true })}`);
      });
    }
    lines.push('', 'Abra **Ver detalhe** no ranking para a tela cheia.');
    return lines.join('\n');
  }

  function findBestEntity(ctx, question) {
    const qn = norm(question);
    const qTokens = tokens(question);
    const meta = ctx.meta || {};
    let best = null;

    function consider(kind, name, scoreBoost = 0) {
      const nn = norm(name);
      if (!nn || nn.length < 3) return;
      let score = 0;
      if (qn.includes(nn)) score += 20 + nn.length;
      qTokens.forEach((t) => {
        if (nn.includes(t)) score += t.length;
      });
      score += scoreBoost;
      if (score > 0 && (!best || score > best.score)) {
        best = { kind, name, score };
      }
    }

    (meta.unidades || []).forEach((u) => consider('unidade', u, 2));
    Object.values(meta.setorMap || {}).flat().forEach((s) => consider('setor', s, 1));
    (meta.tipos || []).forEach((t) => consider('tipo', t, 0));

    const { ccList } = currentSummary(ctx);
    ccList.forEach((c) => {
      if (c.ccNome) consider('ccNome', c.ccNome, 3);
      consider('cc', c.cc, 5);
    });

    return best && best.score >= 6 ? best : null;
  }

  function answerUnit(ctx, unidade) {
    const filters = { ...(ctx.filters || UI.readFilters()), unidade, setor: '', busca: '', categoria: '' };
    const ccList = Engine.aggregateCostCenters(ctx.rows || [], filters);
    const sum = Engine.summary(ccList, filters);
    const top = Engine.sortAttention(ccList).slice(0, 5);
    const lines = [
      `Resumo de **${unidade}**:`,
      Engine.naturalSummary(sum),
      '',
      scopeLine(ctx, filters)
    ];
    top.forEach((c, i) => {
      lines.push(`${i + 1}. **${c.cc}** ${c.ccNome || ''} → ${Engine.formatK(c.diff, { signed: true })} (${c.situacao.label})`);
    });
    return lines.join('\n');
  }

  function answerSetor(ctx, setor) {
    const filters = { ...(ctx.filters || UI.readFilters()), setor, busca: '' };
    const ccList = Engine.aggregateCostCenters(ctx.rows || [], filters);
    if (!ccList.length) return `Não achei o setor **${setor}** no filtro/ano atual.`;
    const sum = Engine.summary(ccList, filters);
    const lines = [
      `Resumo do setor **${setor}**:`,
      Engine.naturalSummary(sum),
      ''
    ];
    Engine.sortAttention(ccList).slice(0, 5).forEach((c, i) => {
      lines.push(`${i + 1}. **${c.cc}** (${c.unidade}) → ${Engine.formatK(c.diff, { signed: true })}`);
    });
    return lines.join('\n');
  }

  function answerTipo(ctx, tipo) {
    const filters = { ...(ctx.filters || UI.readFilters()), categoria: tipo, busca: '' };
    const ccList = Engine.aggregateCostCenters(ctx.rows || [], filters);
    if (!ccList.length) return `Não há dados para a categoria **${tipo}** no filtro atual.`;
    const sum = Engine.summary(ccList, filters);
    return [
      `Categoria **${tipo}**:`,
      Engine.naturalSummary(sum),
      '',
      scopeLine(ctx, filters)
    ].join('\n');
  }

  function answerByCcName(ctx, name) {
    const { filters, ccList } = currentSummary(ctx);
    const nn = norm(name);
    const hits = ccList.filter((c) => norm(c.ccNome).includes(nn) || norm(c.cc).includes(nn));
    if (!hits.length) return null;
    if (hits.length === 1) return answerCc(ctx, hits[0].cc);
    const lines = [`Encontrei **${hits.length}** centros parecidos com “${name}”:`, ''];
    Engine.sortAttention(hits).slice(0, 6).forEach((c, i) => {
      lines.push(`${i + 1}. **${c.cc}** — ${c.ccNome || ''} · ${Engine.formatK(c.diff, { signed: true })}`);
    });
    lines.push('', `Filtros: ${scopeLine(ctx, filters)}`);
    return lines.join('\n');
  }

  function answerYear(ctx) {
    return [
      `O ano em análise agora é **${ctx.year || 2026}**.`,
      'Troque pelo filtro **Ano** em Detalhes.',
      'No Admin, cada forecast (Budget/FC1/FC2/FC3) pode ter planilha por ano.'
    ].join('\n');
  }

  const GUIDE_INTENTS = new Set([
    'help', 'overview', 'tab_inicio', 'tab_detalhes', 'tab_dax', 'tab_contratos',
    'howto', 'admin', 'upload', 'scenarios', 'glossary', 'year'
  ]);

  function scoreIntent(q) {
    const scores = {};
    const bump = (k, n) => { scores[k] = (scores[k] || 0) + n; };

    if (/(ajuda|o que voce faz|o que voce pode|como funciona o (copilot|assistente|ajudante)|help|comandos|o que posso perguntar)/.test(q)) {
      bump('help', 12);
    }
    if (/(o que (tem|ha|há) (neste |nesse |no )?(app|sistema)|quais abas|o que (e|é) (o )?tsoc|para que (serve|serve o) (este |esse )?(app|sistema)|mapa do app|visao geral do app|visão geral do app)/.test(q)) {
      bump('overview', 14);
    }
    if (/(aba |tela |menu ).{0,12}(resumo|inicio|início|executivo)|o que (faz|mostra|tem) (a |o )?(aba |tela )?(resumo|inicio|início)/.test(q)) {
      bump('tab_inicio', 13);
    }
    if (/(aba |tela ).{0,12}detalh|o que (faz|mostra|tem).{0,20}detalh|como (usar|ler) (a )?detalh/.test(q)) {
      bump('tab_detalhes', 13);
    }
    if (/(aba |tela ).{0,12}dax|o que (faz|mostra|tem|e|é).{0,20}dax|regras de negocio|regras de negócio|pseudocodigo|pseudocódigo/.test(q)) {
      bump('tab_dax', 13);
    }
    if (/(aba |tela ).{0,12}contrat|o que (faz|mostra|tem).{0,20}contrat|mapa de calor|ksb1/.test(q)
      && !/(enviar|upload|atualizar).{0,15}ksb1/.test(q)) {
      bump('tab_contratos', 12);
    }
    if (/(como filtr|como usar|como ler|como navegar|onde fica o filtro|como (eu )?filtro)/.test(q)) {
      bump('howto', 11);
    }
    if (/(quem pode|cwid|administrador|autoriz|pessoas autoriz)/.test(q)) bump('admin', 10);
    if (/(como (enviar|atualizar|subir)|upload|enviar planilha|enviar (o )?relatorio|enviar (o )?ksb1)/.test(q)) {
      bump('upload', 11);
    }
    if (/(o que (e|é|significa)|significa o que|definir|definicao|definição|explica)/.test(q)) {
      if (/\bytd\b|acumulado/.test(q)) bump('glossary', 14);
      else if (/\bgap\b/.test(q)) bump('glossary', 14);
      else if (/\bksb1\b/.test(q)) bump('glossary', 14);
      else if (/\b(cc|centro de custo)\b/.test(q)) bump('glossary', 13);
      else if (/\bact\b/.test(q)) bump('glossary', 13);
      else if (/\bk\b|milhar/.test(q)) bump('glossary', 12);
      else if (/(budget|fc1|fc2|fc3|forecast|cenario|cenário|previsto|realizado|diferenca|diferença|estouro|economia)/.test(q)) {
        bump('scenarios', 13);
      }
    }
    if (/(acima|estouro|estouros|estourad|pior|maior desvio|problemas|vermelho)/.test(q)) bump('overruns', 9);
    if (/(economia|abaixo do previsto|melhor resultado|poupanca|poupança|verde)/.test(q)) bump('savings', 8);
    if (/(ranking|top\b|maiores desvios|lista os centros)/.test(q)) bump('overruns', 7);
    if (/(resumo|status|situacao|situação|como esta o|como está o|panorama|visao geral|visão geral)/.test(q)
      && !/(app|sistema|aba)/.test(q)) {
      bump('summary', 8);
    }
    if (/(quantas? unidades|quantos? centros|quantos? setores|quantas? categorias|quantos? tipos|quantos? ccs)/.test(q)) {
      bump('counts', 11);
    }

    const askingValue = /(quanto (e|é|foi|esta|está)|valor (do|da|de)|total (do|da|de)|numero do|número do|me diga o|qual (e|é) o)/.test(q);
    const comparesPrevisto = /(acima|abaixo).{0,20}previsto/.test(q);
    if (askingValue && /\brealizado\b/.test(q)) bump('realizado', 12);
    else if (askingValue && /\bprevisto\b/.test(q) && !comparesPrevisto) bump('previsto', 12);
    else if (askingValue && /\bdiferenca\b/.test(q)) bump('diferenca', 12);
    else if (askingValue && /(realizado|previsto|diferenca|totais|numeros|números)/.test(q) && !comparesPrevisto) {
      bump('totals', 9);
    }

    if (/(qual ano|ano (atual|selecionado|da analise|da análise)|trocar (o )?ano)/.test(q)) bump('year', 9);

    let best = null;
    let bestScore = 0;
    Object.entries(scores).forEach(([k, v]) => {
      if (v > bestScore) {
        best = k;
        bestScore = v;
      }
    });
    return bestScore >= 7 ? best : null;
  }

  function glossaryTermFromQuestion(q) {
    if (/\bytd\b|acumulado/.test(q)) return 'ytd';
    if (/\bgap\b/.test(q)) return 'gap';
    if (/\bksb1\b/.test(q)) return 'ksb1';
    if (/\b(cc|centro de custo)\b/.test(q)) return 'cc';
    if (/\bact\b/.test(q)) return 'act';
    if (/\bk\b|milhar/.test(q)) return 'k';
    return null;
  }

  function answerGuide(intent, q) {
    if (intent === 'help') return answerHelp();
    if (intent === 'overview') return answerAppOverview();
    if (intent === 'tab_inicio') return answerTabInicio();
    if (intent === 'tab_detalhes') return answerTabDetalhes();
    if (intent === 'tab_dax') return answerTabDax();
    if (intent === 'tab_contratos') return answerTabContratos();
    if (intent === 'howto') return answerHowToFilter();
    if (intent === 'admin') return answerAdmin();
    if (intent === 'upload') return answerUpload();
    if (intent === 'scenarios') return answerScenarios();
    if (intent === 'glossary') return answerGlossary(glossaryTermFromQuestion(q));
    return null;
  }

  function answer(question) {
    const raw = String(question || '').trim();
    const q = norm(raw);
    const ctx = getContext();
    if (!q) {
      return 'Pergunte algo sobre o app (abas, filtros) ou sobre os custos do recorte atual. Digite **ajuda** para ver exemplos.';
    }

    try {
      const intent = scoreIntent(q);

      // Guias do app funcionam mesmo sem dados carregados
      if (intent && GUIDE_INTENTS.has(intent)) {
        if (intent === 'year') return answerYear(ctx);
        const guide = answerGuide(intent, q);
        if (guide) return guide;
      }

      if (!hasRows(ctx)) {
        return [
          'Ainda não há dados do Relatorio carregados para o ano atual.',
          'Peça upload no **Administrador** ou volte a um ano com base (ex.: 2026).',
          '',
          'Enquanto isso posso explicar o app: “quais abas existem?”, “como filtrar?”, “o que é FC2?”.'
        ].join('\n');
      }

      const cc = extractCc(raw);
      if (cc) return answerCc(ctx, cc);

      if (intent === 'overruns') return answerOverruns(ctx);
      if (intent === 'savings') return answerSavings(ctx);
      if (intent === 'summary') return answerSummary(ctx);
      if (intent === 'counts') return answerCounts(ctx);
      if (intent === 'realizado') return answerTotals(ctx, 'realizado');
      if (intent === 'previsto') return answerTotals(ctx, 'previsto');
      if (intent === 'diferenca') return answerTotals(ctx, 'diferenca');
      if (intent === 'totals') return answerTotals(ctx, 'all');

      const entity = findBestEntity(ctx, raw);
      if (entity) {
        if (entity.kind === 'unidade') return answerUnit(ctx, entity.name);
        if (entity.kind === 'setor') return answerSetor(ctx, entity.name);
        if (entity.kind === 'tipo') return answerTipo(ctx, entity.name);
        if (entity.kind === 'cc') return answerCc(ctx, entity.name);
        if (entity.kind === 'ccNome') {
          const byName = answerByCcName(ctx, entity.name);
          if (byName) return byName;
        }
      }

      const qTokens = tokens(raw);
      if (qTokens.length) {
        const { ccList } = currentSummary(ctx);
        const hits = Engine.sortAttention(ccList.filter((c) => {
          const blob = norm(`${c.cc} ${c.ccNome} ${c.unidade} ${c.setor}`);
          return qTokens.some((t) => blob.includes(t));
        })).slice(0, 5);
        if (hits.length) {
          const lines = [
            'Achei isto nos dados atuais relacionados à sua pergunta:',
            ''
          ];
          hits.forEach((c, i) => {
            lines.push(`${i + 1}. **${c.cc}** — ${c.ccNome || ''} · ${c.unidade} → ${Engine.formatK(c.diff, { signed: true })}`);
          });
          lines.push('', 'Ou pergunte: “resumo atual”, “centros acima”, “o que faz a aba Contratos?” ou um código MW…');
          return lines.join('\n');
        }
      }

      return [
        'Não encaixei a pergunta. Posso ajudar com **o app** ou com **os números** atuais:',
        '',
        answerSummary(ctx),
        '',
        'Exemplos: “quais abas existem?”, “como filtrar?”, “quanto é o realizado?”, um CC (MW…). Digite **ajuda**.'
      ].join('\n');
    } catch (err) {
      console.error('CopilotAgent', err);
      return 'Tive um erro ao consultar. Recarregue a página e tente de novo (ex.: “ajuda” ou “resumo atual”).';
    }
  }

  return { setContextProvider, answer };
})();
