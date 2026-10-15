/* Gate leve para publicação web: pede e-mail @bayer.com (não é autenticação corporativa). */
(function () {
  const host = String(location.hostname || '');
  if (!host || /^(localhost|127\.0\.0\.1)$/i.test(host)) return;

  const KEY = 'tsoc-bfr-web-gate-v1';
  try {
    if (sessionStorage.getItem(KEY)) return;
  } catch (_) { /* ignore */ }

  const style = document.createElement('style');
  style.textContent = `
    #tsoc-web-gate{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;
      background:linear-gradient(160deg,#0B2A4A 0%,#061c33 100%);font-family:"Open Sans",system-ui,sans-serif;padding:1.25rem}
    #tsoc-web-gate .box{width:min(420px,100%);background:#fff;border-radius:14px;padding:1.35rem 1.4rem 1.2rem;
      box-shadow:0 18px 50px rgba(0,0,0,.28)}
    #tsoc-web-gate h1{margin:0 0 .35rem;font-size:1.15rem;color:#0B2A4A;font-family:Montserrat,sans-serif}
    #tsoc-web-gate p{margin:0 0 .85rem;color:#5a6f7d;font-size:.88rem;line-height:1.45}
    #tsoc-web-gate label{display:block;font-size:.72rem;font-weight:700;color:#0B2A4A;margin-bottom:.3rem;text-transform:uppercase;letter-spacing:.04em}
    #tsoc-web-gate input{width:100%;box-sizing:border-box;border:1px solid #d5dee6;border-radius:10px;padding:.65rem .75rem;font:inherit}
    #tsoc-web-gate button{margin-top:.75rem;width:100%;border:0;border-radius:10px;padding:.7rem .85rem;background:#0B2A4A;color:#fff;
      font:700 .9rem Montserrat,sans-serif;cursor:pointer}
    #tsoc-web-gate .err{color:#B42318;font-size:.8rem;margin:.45rem 0 0;min-height:1.1em}
  `;
  document.head.appendChild(style);

  const gate = document.createElement('div');
  gate.id = 'tsoc-web-gate';
  gate.setAttribute('role', 'dialog');
  gate.setAttribute('aria-modal', 'true');
  gate.innerHTML = `
    <div class="box">
      <h1>TSOC BFR 2026</h1>
      <p>Acesso interno Bayer. Informe seu e-mail corporativo para continuar.</p>
      <label for="tsoc-web-gate-email">E-mail @bayer.com</label>
      <input id="tsoc-web-gate-email" type="email" autocomplete="username" placeholder="nome.sobrenome@bayer.com">
      <div class="err" id="tsoc-web-gate-err" aria-live="polite"></div>
      <button type="button" id="tsoc-web-gate-go">Entrar</button>
    </div>`;
  document.documentElement.appendChild(gate);

  const input = gate.querySelector('#tsoc-web-gate-email');
  const err = gate.querySelector('#tsoc-web-gate-err');
  const go = gate.querySelector('#tsoc-web-gate-go');

  function okEmail(v) {
    return /^[^\s@]+@bayer\.com$/i.test(String(v || '').trim());
  }

  function pass() {
    try { sessionStorage.setItem(KEY, String(input.value || '').trim().toLowerCase()); } catch (_) { /* ignore */ }
    gate.remove();
    style.remove();
  }

  function tryEnter() {
    if (!okEmail(input.value)) {
      err.textContent = 'Use um e-mail @bayer.com válido.';
      input.focus();
      return;
    }
    pass();
  }

  go.addEventListener('click', tryEnter);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') tryEnter();
  });
  setTimeout(() => input.focus(), 50);
})();
