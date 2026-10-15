/* Ações da planilha (aba Ações) + gestão de pessoas pelo Admin */
const Actions = (() => {
  const STORE_KEY = '_actions';
  let seedActions = [];
  let localState = {
    actions: [],
    peopleExtra: [] // { nome, addedBy, addedAt }
  };

  function normName(s) {
    return String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function splitQuem(raw) {
    return String(raw || '')
      .split(/\s*\/\s*|\s*,\s*/)
      .map((p) => p.trim())
      .filter(Boolean);
  }

  function uid(prefix = 'acao') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  async function loadSeed() {
    const res = await fetch('data/acoes.json', { cache: 'no-store' });
    if (!res.ok) {
      seedActions = [];
      return [];
    }
    const json = await res.json();
    seedActions = (json.actions || []).map((a) => ({
      ...a,
      quem: Array.isArray(a.quem) ? a.quem.slice() : splitQuem(a.quem),
      quemExtra: Array.isArray(a.quemExtra) ? a.quemExtra.slice() : [],
      source: a.source || 'seed'
    }));
    return seedActions;
  }

  async function loadLocal() {
    const pack = await Storage.getSlot(STORE_KEY);
    if (pack?.meta?.kind === 'actions') {
      localState = {
        actions: Array.isArray(pack.meta.actions) ? pack.meta.actions : [],
        peopleExtra: Array.isArray(pack.meta.peopleExtra) ? pack.meta.peopleExtra : []
      };
    } else {
      localState = { actions: [], peopleExtra: [] };
    }
    return localState;
  }

  async function persist() {
    await Storage.saveSlot(STORE_KEY, {
      fileName: 'acoes-local',
      uploadedAt: new Date().toISOString(),
      rows: [],
      meta: {
        kind: 'actions',
        actions: localState.actions,
        peopleExtra: localState.peopleExtra
      }
    });
  }

  function allActions() {
    const overrides = new Map(localState.actions.map((a) => [a.id, a]));
    const merged = [];
    seedActions.forEach((s) => {
      merged.push(overrides.has(s.id) ? { ...s, ...overrides.get(s.id) } : { ...s });
    });
    localState.actions.forEach((a) => {
      if (!seedActions.some((s) => s.id === a.id)) merged.push({ ...a });
    });
    return merged.filter((a) => !a.deleted);
  }

  function listPeople() {
    const fromActions = new Set();
    allActions().forEach((a) => {
      (a.quem || []).forEach((n) => fromActions.add(n));
      (a.quemExtra || []).forEach((x) => fromActions.add(x.nome));
    });
    localState.peopleExtra.forEach((p) => fromActions.add(p.nome));
    return [...fromActions].filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }

  function listPeopleManaged(sessionCwid) {
    return localState.peopleExtra
      .filter((p) => !sessionCwid || p.addedBy === sessionCwid)
      .slice()
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }

  function filterActions({ mes = '', setor = '', quem = '', status = '' } = {}) {
    return allActions().filter((a) => {
      if (mes && a.mes !== mes && String(a.mesNumero) !== String(mes)) return false;
      if (setor && !normName(a.setor).includes(normName(setor))) return false;
      if (quem) {
        const qn = normName(quem);
        const names = [
          ...(a.quem || []),
          ...((a.quemExtra || []).map((x) => x.nome))
        ];
        if (!names.some((n) => normName(n).includes(qn))) return false;
      }
      if (status === 'aberta' && a.concluido) return false;
      if (status === 'concluida' && !a.concluido) return false;
      return true;
    }).sort((a, b) => (a.mesNumero || 99) - (b.mesNumero || 99) || String(a.setor).localeCompare(String(b.setor), 'pt-BR'));
  }

  async function addPerson(nome, session) {
    const n = String(nome || '').trim();
    if (!n || n.length < 2) throw new Error('Informe o nome da pessoa.');
    const exists = localState.peopleExtra.some((p) => normName(p.nome) === normName(n));
    if (exists) throw new Error('Essa pessoa já foi incluída.');
    localState.peopleExtra.push({
      nome: n,
      addedBy: session?.cwid || '',
      addedAt: new Date().toISOString()
    });
    await persist();
    return listPeopleManaged(session?.cwid);
  }

  async function excludePerson(nome, session) {
    const n = normName(nome);
    const owned = localState.peopleExtra.find((p) => normName(p.nome) === n);
    if (!owned) throw new Error('Pessoa não encontrada entre as que você incluiu.');
    if (session?.cwid && owned.addedBy && owned.addedBy !== session.cwid) {
      throw new Error('Só é possível excluir pessoas que você mesma(o) incluiu.');
    }
    localState.peopleExtra = localState.peopleExtra.filter((p) => normName(p.nome) !== n);
    localState.actions = allActions().map((a) => ({
      ...a,
      quemExtra: (a.quemExtra || []).filter((x) => {
        if (normName(x.nome) !== n) return true;
        return Boolean(session?.cwid && x.addedBy && x.addedBy !== session.cwid);
      })
    }));
    const seedIds = new Set(seedActions.map((s) => s.id));
    localState.actions = localState.actions.filter((a) => {
      if (!seedIds.has(a.id)) return true;
      const seed = seedActions.find((s) => s.id === a.id);
      return JSON.stringify(a.quemExtra || []) !== JSON.stringify(seed?.quemExtra || [])
        || a.deleted
        || a.concluido !== seed.concluido;
    });
    await persist();
    return listPeopleManaged(session?.cwid);
  }

  async function addPersonToAction(actionId, nome, session) {
    const n = String(nome || '').trim();
    if (!n) throw new Error('Informe o nome.');
    const current = allActions().find((a) => a.id === actionId);
    if (!current) throw new Error('Ação não encontrada.');
    const quemExtra = [...(current.quemExtra || [])];
    if ([...(current.quem || []), ...quemExtra.map((x) => x.nome)].some((x) => normName(x) === normName(n))) {
      throw new Error('Pessoa já está nesta ação.');
    }
    quemExtra.push({
      nome: n,
      addedBy: session?.cwid || '',
      addedAt: new Date().toISOString()
    });
    upsertLocalAction({ ...current, quemExtra });
    // also ensure in people roster
    if (!localState.peopleExtra.some((p) => normName(p.nome) === normName(n))) {
      localState.peopleExtra.push({
        nome: n,
        addedBy: session?.cwid || '',
        addedAt: new Date().toISOString()
      });
    }
    await persist();
    return allActions().find((a) => a.id === actionId);
  }

  async function removePersonFromAction(actionId, nome, session) {
    const current = allActions().find((a) => a.id === actionId);
    if (!current) throw new Error('Ação não encontrada.');
    const n = normName(nome);
    const quemExtra = (current.quemExtra || []).filter((x) => {
      if (normName(x.nome) !== n) return true;
      if (session?.cwid && x.addedBy && x.addedBy !== session.cwid) {
        throw new Error('Só é possível excluir pessoas que você incluiu nesta ação.');
      }
      return false;
    });
    if ((current.quemExtra || []).length === quemExtra.length) {
      throw new Error('Só pessoas incluídas por você podem ser excluídas desta ação.');
    }
    upsertLocalAction({ ...current, quemExtra });
    await persist();
    return allActions().find((a) => a.id === actionId);
  }

  function upsertLocalAction(action) {
    const idx = localState.actions.findIndex((a) => a.id === action.id);
    if (idx >= 0) localState.actions[idx] = action;
    else localState.actions.push(action);
  }

  async function createAction(payload, session) {
    const action = {
      id: uid('admin'),
      mes: payload.mes || 'ago',
      mesNumero: payload.mesNumero || null,
      setor: String(payload.setor || '').trim(),
      comentario: String(payload.comentario || '').trim(),
      quem: [],
      quemExtra: splitQuem(payload.quem).map((nome) => ({
        nome,
        addedBy: session?.cwid || '',
        addedAt: new Date().toISOString()
      })),
      prazo: String(payload.prazo || '').trim(),
      concluido: Boolean(payload.concluido),
      source: 'admin',
      addedBy: session?.cwid || ''
    };
    if (!action.comentario) throw new Error('Informe o comentário / descrição da ação.');
    action.quemExtra.forEach((x) => {
      if (!localState.peopleExtra.some((p) => normName(p.nome) === normName(x.nome))) {
        localState.peopleExtra.push({
          nome: x.nome,
          addedBy: session?.cwid || '',
          addedAt: new Date().toISOString()
        });
      }
    });
    localState.actions.push(action);
    await persist();
    return action;
  }

  async function toggleConcluido(actionId) {
    const current = allActions().find((a) => a.id === actionId);
    if (!current) throw new Error('Ação não encontrada.');
    upsertLocalAction({ ...current, concluido: !current.concluido });
    await persist();
  }

  async function deleteAction(actionId, session) {
    const current = allActions().find((a) => a.id === actionId);
    if (!current) return;
    if (current.source === 'admin' && current.addedBy && session?.cwid && current.addedBy !== session.cwid) {
      throw new Error('Só é possível excluir ações que você criou.');
    }
    if (current.source === 'seed') {
      upsertLocalAction({ ...current, deleted: true });
    } else {
      localState.actions = localState.actions.filter((a) => a.id !== actionId);
    }
    await persist();
  }

  async function importFromSheet(actionsFromSheet) {
    if (!actionsFromSheet?.length) return;
    // replace seed-like imports with sheet snapshot as local overrides tagged imported
    const imported = actionsFromSheet.map((a, i) => ({
      ...a,
      id: a.id || `import_${i + 1}`,
      source: 'import',
      quem: Array.isArray(a.quem) ? a.quem : splitQuem(a.quem),
      quemExtra: a.quemExtra || []
    }));
    // keep admin-created actions
    const adminOnly = localState.actions.filter((a) => a.source === 'admin');
    localState.actions = [...imported, ...adminOnly];
    await persist();
  }

  return {
    loadSeed,
    loadLocal,
    allActions,
    filterActions,
    listPeople,
    listPeopleManaged,
    addPerson,
    excludePerson,
    addPersonToAction,
    removePersonFromAction,
    createAction,
    toggleConcluido,
    deleteAction,
    importFromSheet,
    splitQuem
  };
})();
