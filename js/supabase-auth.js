/* Auth de acesso ao app via Supabase (magic link / OTP) + lista authorized_emails */
const SupaAuth = (() => {
  let client = null;
  let profile = null; // { email, nome, is_admin }
  let ready = false;

  function cfg() {
    return window.SUPABASE_CONFIG || {};
  }

  function isConfigured() {
    const c = cfg();
    return Boolean(c.enabled && c.url && c.anonKey && window.supabase?.createClient);
  }

  function normalizeEmail(v) {
    return String(v || '').trim().toLowerCase();
  }

  function isBayerEmail(email) {
    const domain = String(cfg().emailDomain || 'bayer.com').toLowerCase();
    const e = normalizeEmail(email);
    return new RegExp(`^[^\\s@]+@${domain.replace(/\./g, '\\.')}$`, 'i').test(e);
  }

  function redirectTo() {
    const custom = String(cfg().redirectTo || '').trim();
    if (custom) return custom;
    return `${location.origin}${location.pathname}`.replace(/index\.html$/i, '');
  }

  function getClient() {
    if (!isConfigured()) return null;
    if (client) return client;
    client = window.supabase.createClient(cfg().url, cfg().anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
    return client;
  }

  function ensureUi() {
    if (document.getElementById('tsoc-supa-gate')) return;
    const style = document.createElement('style');
    style.id = 'tsoc-supa-gate-style';
    style.textContent = `
      #tsoc-supa-gate{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;
        background:linear-gradient(160deg,#0B2A4A 0%,#061c33 100%);font-family:"Open Sans",system-ui,sans-serif;padding:1.25rem}
      #tsoc-supa-gate .box{width:min(440px,100%);background:#fff;border-radius:14px;padding:1.4rem 1.45rem 1.25rem;
        box-shadow:0 18px 50px rgba(0,0,0,.28)}
      #tsoc-supa-gate h1{margin:0 0 .35rem;font-size:1.2rem;color:#0B2A4A;font-family:Montserrat,sans-serif}
      #tsoc-supa-gate p{margin:0 0 .85rem;color:#5a6f7d;font-size:.88rem;line-height:1.45}
      #tsoc-supa-gate label{display:block;font-size:.72rem;font-weight:700;color:#0B2A4A;margin:0 0 .3rem;text-transform:uppercase;letter-spacing:.04em}
      #tsoc-supa-gate input{width:100%;box-sizing:border-box;border:1px solid #d5dee6;border-radius:10px;padding:.65rem .75rem;font:inherit}
      #tsoc-supa-gate .row{display:flex;gap:.5rem;margin-top:.75rem}
      #tsoc-supa-gate button{border:0;border-radius:10px;padding:.7rem .85rem;font:700 .88rem Montserrat,sans-serif;cursor:pointer}
      #tsoc-supa-gate .primary{flex:1;background:#0B2A4A;color:#fff}
      #tsoc-supa-gate .ghost{background:#eef2f5;color:#0B2A4A}
      #tsoc-supa-gate .err{color:#B42318;font-size:.8rem;margin:.5rem 0 0;min-height:1.1em}
      #tsoc-supa-gate .ok{color:#0b6e4f;font-size:.8rem;margin:.5rem 0 0;min-height:1.1em}
      #tsoc-supa-gate .hint{margin-top:.65rem;font-size:.75rem;color:#5a6f7d}
      body.tsoc-locked .app-shell,body.tsoc-locked .detail-screen,body.tsoc-locked .copilot-fab,body.tsoc-locked .copilot-panel{visibility:hidden!important}
    `;
    document.head.appendChild(style);

    const gate = document.createElement('div');
    gate.id = 'tsoc-supa-gate';
    gate.setAttribute('role', 'dialog');
    gate.setAttribute('aria-modal', 'true');
    gate.innerHTML = `
      <div class="box">
        <h1>TSOC BFR 2026</h1>
        <p>Acesso restrito. Entre com seu e-mail Bayer autorizado. Enviaremos um link magico.</p>
        <div id="tsoc-supa-step-email">
          <label for="tsoc-supa-email">E-mail @bayer.com</label>
          <input id="tsoc-supa-email" type="email" autocomplete="username" placeholder="nome.sobrenome@bayer.com">
          <div class="row">
            <button type="button" class="primary" id="tsoc-supa-send">Enviar link</button>
          </div>
        </div>
        <div id="tsoc-supa-step-otp" hidden>
          <label for="tsoc-supa-otp">Codigo do e-mail (se pediu OTP)</label>
          <input id="tsoc-supa-otp" inputmode="numeric" autocomplete="one-time-code" placeholder="6 digitos">
          <div class="row">
            <button type="button" class="ghost" id="tsoc-supa-back">Voltar</button>
            <button type="button" class="primary" id="tsoc-supa-verify">Validar codigo</button>
          </div>
        </div>
        <div class="err" id="tsoc-supa-err" aria-live="polite"></div>
        <div class="ok" id="tsoc-supa-ok" aria-live="polite"></div>
        <p class="hint">So entram e-mails cadastrados pelo administrador no Supabase.</p>
      </div>`;
    document.documentElement.appendChild(gate);

    gate.querySelector('#tsoc-supa-send').addEventListener('click', () => sendMagicLink());
    gate.querySelector('#tsoc-supa-verify').addEventListener('click', () => verifyOtp());
    gate.querySelector('#tsoc-supa-back').addEventListener('click', () => showEmailStep());
    gate.querySelector('#tsoc-supa-email').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendMagicLink();
    });
    gate.querySelector('#tsoc-supa-otp').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') verifyOtp();
    });
  }

  function setMsg(errText, okText) {
    const err = document.getElementById('tsoc-supa-err');
    const ok = document.getElementById('tsoc-supa-ok');
    if (err) err.textContent = errText || '';
    if (ok) ok.textContent = okText || '';
  }

  function showEmailStep() {
    const a = document.getElementById('tsoc-supa-step-email');
    const b = document.getElementById('tsoc-supa-step-otp');
    if (a) a.hidden = false;
    if (b) b.hidden = true;
  }

  function showOtpStep() {
    const a = document.getElementById('tsoc-supa-step-email');
    const b = document.getElementById('tsoc-supa-step-otp');
    if (a) a.hidden = true;
    if (b) b.hidden = false;
    document.getElementById('tsoc-supa-otp')?.focus();
  }

  function lockUi(locked) {
    document.body.classList.toggle('tsoc-locked', Boolean(locked));
    const gate = document.getElementById('tsoc-supa-gate');
    if (gate) gate.hidden = !locked;
  }

  async function sendMagicLink() {
    const email = normalizeEmail(document.getElementById('tsoc-supa-email')?.value);
    setMsg('', '');
    if (!isBayerEmail(email)) {
      setMsg(`Use um e-mail @${cfg().emailDomain || 'bayer.com'}.`);
      return;
    }
    const sb = getClient();
    if (!sb) {
      setMsg('Supabase nao configurado (js/supabase-config.js).');
      return;
    }
    const btn = document.getElementById('tsoc-supa-send');
    if (btn) btn.disabled = true;
    try {
      const { error } = await sb.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: redirectTo()
        }
      });
      if (error) {
        setMsg(error.message || 'Falha ao enviar o link.');
        return;
      }
      setMsg('', 'Enviamos um link/codigo para seu e-mail. Abra o link ou digite o codigo.');
      showOtpStep();
    } catch (e) {
      setMsg(e?.message || 'Falha de rede ao autenticar.');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function verifyOtp() {
    const email = normalizeEmail(document.getElementById('tsoc-supa-email')?.value);
    const token = String(document.getElementById('tsoc-supa-otp')?.value || '').trim();
    setMsg('', '');
    if (!token) {
      setMsg('Informe o codigo do e-mail.');
      return;
    }
    const sb = getClient();
    if (!sb) return;
    const { error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
    if (error) {
      setMsg(error.message || 'Codigo invalido.');
      return;
    }
    await refreshAccess();
  }

  async function loadProfile() {
    const sb = getClient();
    if (!sb) return null;
    const { data, error } = await sb.rpc('my_access_profile');
    if (error) {
      console.warn('my_access_profile', error);
      return null;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.email) return null;
    return {
      email: normalizeEmail(row.email),
      nome: String(row.nome || '').trim(),
      is_admin: Boolean(row.is_admin)
    };
  }

  async function refreshAccess() {
    const sb = getClient();
    if (!sb) {
      profile = null;
      lockUi(false);
      return { ok: true, skipped: true };
    }

    ensureUi();
    const { data: sessData } = await sb.auth.getSession();
    const session = sessData?.session;
    if (!session?.user?.email) {
      profile = null;
      lockUi(true);
      showEmailStep();
      return { ok: false, reason: 'no-session' };
    }

    const email = normalizeEmail(session.user.email);
    if (!isBayerEmail(email)) {
      await sb.auth.signOut();
      profile = null;
      lockUi(true);
      setMsg('Apenas e-mails Bayer sao aceitos.');
      return { ok: false, reason: 'domain' };
    }

    const { data: allowed, error: allowErr } = await sb.rpc('is_app_allowed');
    if (allowErr) {
      console.warn(allowErr);
      await sb.auth.signOut();
      profile = null;
      lockUi(true);
      setMsg('Nao foi possivel validar autorizacao. Confira o SQL no Supabase.');
      return { ok: false, reason: 'rpc' };
    }
    if (!allowed) {
      await sb.auth.signOut();
      profile = null;
      lockUi(true);
      setMsg('Seu e-mail nao esta autorizado. Peca ao administrador para incluir na lista.');
      showEmailStep();
      return { ok: false, reason: 'not-allowed' };
    }

    profile = await loadProfile();
    if (!profile) {
      profile = { email, nome: email.split('@')[0], is_admin: false };
    }

    // Espelha sessao no Auth admin quando is_admin
    try {
      if (profile.is_admin && window.Auth?.login) {
        Auth.login(profile.email);
      }
    } catch (_) { /* ignore */ }

    lockUi(false);
    setMsg('', '');
    document.dispatchEvent(new CustomEvent('tsoc:auth', { detail: { profile } }));
    return { ok: true, profile };
  }

  async function init() {
    if (!isConfigured()) {
      ready = true;
      // Remove gate fraco antigo se existir
      document.getElementById('tsoc-web-gate')?.remove();
      return { ok: true, skipped: true };
    }
    ensureUi();
    lockUi(true);
    const sb = getClient();
    sb.auth.onAuthStateChange(async (event) => {
      if (event === 'SIGNED_OUT') {
        profile = null;
        lockUi(true);
        showEmailStep();
        return;
      }
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        await refreshAccess();
      }
    });
    const result = await refreshAccess();
    ready = true;
    return result;
  }

  async function signOut() {
    const sb = getClient();
    if (sb) await sb.auth.signOut();
    profile = null;
    try { Auth.logout(); } catch (_) { /* ignore */ }
    lockUi(isConfigured());
    showEmailStep();
  }

  function getProfile() {
    return profile;
  }

  function isAppLoggedIn() {
    if (!isConfigured()) return true; // modo local sem Supabase
    return Boolean(profile?.email);
  }

  return {
    init,
    isConfigured,
    isAppLoggedIn,
    getProfile,
    signOut,
    refreshAccess,
    getClient
  };
})();
