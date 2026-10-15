/* Autenticação por CWID Bayer (aba Administrador) */
const Auth = (() => {
  const SESSION_KEY = 'tsoc-bfr-admin-session';
  const EXTRA_KEY = 'tsoc-bfr-cwids-extra-v2';
  const EXTRA_LEGACY_KEY = 'tsoc-bfr-cwids-extra';
  const REVOKED_KEY = 'tsoc-bfr-cwids-revoked';

  let baseList = [];
  let nameMap = {};
  let emailToCwid = {};

  function normalize(cwid) {
    return String(cwid || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
  }

  /** Aceita e-mail @bayer.com ou CWID — Admin só se estiver na lista autorizados. */
  function parseLogin(input) {
    const raw = String(input || '').trim();
    const email = raw.toLowerCase();
    const m = email.match(/^([a-z0-9._%+-]+)@bayer\.com$/);
    if (m) {
      const addr = `${m[1]}@bayer.com`;
      const mapped = emailToCwid[addr];
      return {
        kind: 'email',
        id: addr,
        cwid: mapped || '',
        email: addr,
        nome: mapped ? getName(mapped) : m[1]
      };
    }
    const cwid = normalize(raw);
    return {
      kind: 'cwid',
      id: cwid,
      cwid,
      email: '',
      nome: getName(cwid)
    };
  }

  function isBayerEmail(input) {
    return Boolean(String(input || '').trim().toLowerCase().match(/^[a-z0-9._%+-]+@bayer\.com$/));
  }

  function extractEntry(item) {
    if (item == null) return null;
    if (typeof item === 'string' || typeof item === 'number') {
      const cwid = normalize(item);
      return cwid ? { cwid, nome: '', email: '' } : null;
    }
    const cwid = normalize(item.cwid || item.id || item.matricula);
    if (!cwid) return null;
    return {
      cwid,
      nome: String(item.nome || item.name || '').trim(),
      email: String(item.email || '').trim().toLowerCase()
    };
  }

  async function loadAuthorized() {
    try {
      const res = await fetch('data/autorizados.json', { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        const list = json.cwids || json.matriculas || [];
        const parsed = list.map(extractEntry).filter(Boolean);
        baseList = parsed.map((p) => p.cwid);
        nameMap = Object.fromEntries(parsed.filter((p) => p.nome).map((p) => [p.cwid, p.nome]));
        emailToCwid = {};
        parsed.forEach((p) => {
          if (p.email) emailToCwid[p.email] = p.cwid;
        });
      }
    } catch (_) {
      baseList = [];
      nameMap = {};
      emailToCwid = {};
    }
    migrateLegacyExtras();
    return getAuthorizedList();
  }

  function migrateLegacyExtras() {
    try {
      if (localStorage.getItem(EXTRA_KEY)) return;
      const raw = localStorage.getItem(EXTRA_LEGACY_KEY)
        || localStorage.getItem('tsoc-bfr-matriculas-extra');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const extras = (Array.isArray(parsed) ? parsed : [])
        .map((item) => {
          if (typeof item === 'string' || typeof item === 'number') {
            const cwid = normalize(item);
            return cwid ? { cwid, nome: '', addedAt: new Date().toISOString(), addedBy: '' } : null;
          }
          const cwid = normalize(item.cwid);
          if (!cwid) return null;
          return {
            cwid,
            nome: String(item.nome || '').trim(),
            addedAt: item.addedAt || new Date().toISOString(),
            addedBy: item.addedBy || ''
          };
        })
        .filter(Boolean);
      localStorage.setItem(EXTRA_KEY, JSON.stringify(extras));
    } catch (_) { /* ignore */ }
  }

  function getExtras() {
    try {
      const raw = localStorage.getItem(EXTRA_KEY) || '[]';
      return JSON.parse(raw)
        .map((item) => {
          const cwid = normalize(item.cwid || item);
          if (!cwid) return null;
          return {
            cwid,
            nome: String(item.nome || '').trim(),
            addedAt: item.addedAt || '',
            addedBy: item.addedBy || ''
          };
        })
        .filter(Boolean);
    } catch (_) {
      return [];
    }
  }

  function saveExtras(list) {
    localStorage.setItem(EXTRA_KEY, JSON.stringify(list));
  }

  function getRevoked() {
    try {
      return JSON.parse(localStorage.getItem(REVOKED_KEY) || '[]').map(normalize).filter(Boolean);
    } catch (_) {
      return [];
    }
  }

  function saveRevoked(list) {
    localStorage.setItem(REVOKED_KEY, JSON.stringify([...new Set(list)]));
  }

  function getAuthorizedList() {
    const revoked = new Set(getRevoked());
    const extras = getExtras().map((e) => e.cwid);
    return [...new Set([...baseList, ...extras])].filter((cwid) => !revoked.has(cwid));
  }

  function getName(cwid) {
    const n = normalize(cwid);
    const extra = getExtras().find((e) => e.cwid === n);
    return extra?.nome || nameMap[n] || '';
  }

  function getAuthorizedEntries() {
    const revoked = new Set(getRevoked());
    const extras = getExtras();
    const extraMap = Object.fromEntries(extras.map((e) => [e.cwid, e]));
    const all = [...new Set([...baseList, ...extras.map((e) => e.cwid)])];

    return all.map((cwid) => {
      const isBase = baseList.includes(cwid);
      const extra = extraMap[cwid];
      const isRevoked = revoked.has(cwid);
      return {
        cwid,
        nome: extra?.nome || nameMap[cwid] || '',
        isBase,
        isExtra: Boolean(extra) && !isBase,
        isRevoked,
        canExclude: !isRevoked && (Boolean(extra) || isBase),
        addedBy: extra?.addedBy || '',
        addedAt: extra?.addedAt || ''
      };
    }).sort((a, b) => {
      if (a.isRevoked !== b.isRevoked) return a.isRevoked ? 1 : -1;
      return a.cwid.localeCompare(b.cwid);
    });
  }

  function addPerson(cwid, nome = '') {
    const n = normalize(cwid);
    if (!n || n.length < 3) throw new Error('Informe um CWID válido (mín. 3 caracteres).');
    const nomeClean = String(nome || '').trim();
    const session = getSession();

    // reativa se estava revogado
    saveRevoked(getRevoked().filter((x) => x !== n));

    if (baseList.includes(n)) {
      if (nomeClean) nameMap[n] = nomeClean;
      return getAuthorizedEntries();
    }

    const extras = getExtras();
    const idx = extras.findIndex((e) => e.cwid === n);
    if (idx >= 0) {
      extras[idx] = {
        ...extras[idx],
        nome: nomeClean || extras[idx].nome
      };
    } else {
      extras.push({
        cwid: n,
        nome: nomeClean,
        addedAt: new Date().toISOString(),
        addedBy: session?.cwid || ''
      });
    }
    saveExtras(extras);
    return getAuthorizedEntries();
  }

  /** Compat: mantém addCwid antigo */
  function addCwid(cwid, nome) {
    return addPerson(cwid, nome);
  }

  function excludePerson(cwid) {
    const n = normalize(cwid);
    if (!n) throw new Error('CWID inválido.');
    const session = getSession();
    if (session?.cwid === n) {
      throw new Error('Você não pode excluir o próprio acesso enquanto estiver logada(o).');
    }

    const extras = getExtras().filter((e) => e.cwid !== n);
    saveExtras(extras);

    if (baseList.includes(n)) {
      const revoked = getRevoked();
      if (!revoked.includes(n)) {
        revoked.push(n);
        saveRevoked(revoked);
      }
    }

    return getAuthorizedEntries();
  }

  function restorePerson(cwid) {
    const n = normalize(cwid);
    saveRevoked(getRevoked().filter((x) => x !== n));
    return getAuthorizedEntries();
  }

  function removeExtra(cwid) {
    return excludePerson(cwid);
  }

  function isAuthorized(cwidOrEmail) {
    const raw = String(cwidOrEmail || '').trim();
    if (!raw) return false;
    if (isBayerEmail(raw)) {
      const cwid = emailToCwid[raw.toLowerCase()];
      if (!cwid) return false;
      if (getRevoked().includes(cwid)) return false;
      return getAuthorizedList().includes(cwid);
    }
    const n = normalize(raw);
    if (!n) return false;
    if (getRevoked().includes(n)) return false;
    return getAuthorizedList().includes(n);
  }

  function login(cwidOrEmail) {
    const parsed = parseLogin(cwidOrEmail);
    if (parsed.kind === 'email') {
      if (!parsed.cwid || !isAuthorized(parsed.email)) {
        return {
          ok: false,
          message: 'E-mail não autorizado para Admin. Use o CWID autorizado (CBAIS, GPGMS ou GPUST) ou o e-mail cadastrado.'
        };
      }
      const session = {
        cwid: parsed.cwid,
        email: parsed.email,
        nome: parsed.nome || getName(parsed.cwid),
        kind: 'email',
        at: new Date().toISOString()
      };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      return { ok: true, session };
    }
    if (!parsed.cwid || parsed.cwid.length < 3) {
      return { ok: false, message: 'Informe um CWID válido (ex.: CBAIS) ou e-mail autorizado.' };
    }
    if (!isAuthorized(parsed.cwid)) {
      return {
        ok: false,
        message: 'CWID não autorizado. Admin liberado apenas para CBAIS, GPGMS e GPUST.'
      };
    }
    const session = {
      cwid: parsed.cwid,
      email: '',
      nome: parsed.nome || getName(parsed.cwid),
      kind: 'cwid',
      at: new Date().toISOString()
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return { ok: true, session };
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  function getSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const session = JSON.parse(raw);
      const email = session.email ? String(session.email).toLowerCase() : '';
      const cwid = normalize(session.cwid || session.matricula || (email ? emailToCwid[email] : ''));
      if (!cwid || !isAuthorized(cwid)) {
        logout();
        return null;
      }
      return {
        ...session,
        cwid,
        email: email || session.email || '',
        nome: session.nome || getName(cwid),
        kind: email ? 'email' : 'cwid'
      };
    } catch (_) {
      return null;
    }
  }

  function isLoggedIn() {
    return Boolean(getSession());
  }

  return {
    loadAuthorized,
    getAuthorizedList,
    getAuthorizedEntries,
    getName,
    addPerson,
    addCwid,
    excludePerson,
    restorePerson,
    removeExtra,
    isAuthorized,
    login,
    logout,
    getSession,
    isLoggedIn,
    normalize,
    parseLogin,
    isBayerEmail
  };
})();
