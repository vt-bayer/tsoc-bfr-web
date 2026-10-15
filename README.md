# TSOC BFR 2026

App Bayer (Belford Roxo · LATAM) para acompanhar **realizado × previsto** e **contratos KSB1**.

> **Importante:** não abra o `index.html` pelo Explorer. Sempre use o atalho / `iniciar.bat` (abre em `http://localhost:8080`).

Repositório (privado): https://github.com/vt-bayer/tsoc-bfr-custos

---

## Instalar no notebook (qualquer pessoa do time)

### Opção A — GitHub Desktop (recomendada)

1. Peça ao Vitor (`CBAIS`) para **te adicionar** no repositório privado.
2. Instale o [GitHub Desktop](https://desktop.github.com/).
3. Faça login com sua conta GitHub.
4. **File → Clone repository…** → escolha `vt-bayer/tsoc-bfr-custos` → Clone.
5. Na pasta clonada, clique duas vezes em **`instalar.bat`**.
6. Na Área de Trabalho, use o atalho **TSOC BFR 2026** sempre que for abrir o app.

### Opção B — ZIP (sem Git)

1. No GitHub: **Code → Download ZIP** (precisa ter acesso ao repo).
2. Extraia para uma pasta permanente (ex.: `Documentos\tsoc-bfr-custos`).
3. Clique duas vezes em **`instalar.bat`**.
4. Use o atalho **TSOC BFR 2026** na Área de Trabalho.

---

## Como abrir no dia a dia

1. Clique no atalho **TSOC BFR 2026** (ou em `iniciar.bat`).
2. Espere o navegador abrir em **http://localhost:8080**.
3. **Não feche a janela preta** enquanto estiver usando.
4. (Opcional) No Chrome/Edge: menu ⋮ → **Instalar TSOC BFR…** para fixar como app.

---

## Publicar dados para o time ver

Os uploads ficam no navegador de cada notebook. Para **todo mundo ver a mesma base**:

1. No Admin: envie Relatorio / KSB1 e atualize o app.
2. Clique em **3. Publicar para o time** → baixa `shared-pack.json`.
3. Substitua o arquivo em `data/shared-pack.json`.
4. GitHub Desktop: **Commit → Push**.
5. Cada pessoa do time: **Fetch/Pull** e abre o app de novo (F5).

O app carrega automaticamente `data/shared-pack.json` ao iniciar.

---

## Administrador

Qualquer e-mail **`@bayer.com`** entra no Admin — não precisa adicionar pessoa a pessoa.

Também funcionam os CWIDs da lista base (`data/autorizados.json`), se preferir.

Para atualizar contratos: Admin → login com e-mail Bayer → Contratos → enviar KSB1 → **Atualizar contratos**.

---

## Problemas comuns

| Sintoma | Solução |
|---------|---------|
| “CWID não autorizado” + “Erro ao carregar dados” | Você abriu o `index.html` direto. Use o atalho / `iniciar.bat`. |
| Porta 8080 ocupada | Feche a outra janela do TSOC BFR e abra de novo. |
| Sem acesso ao GitHub | Peça convite no repo privado `vt-bayer/tsoc-bfr-custos`. |

---

## Observação sobre os dados

Cada notebook guarda o histórico KSB1 **no próprio navegador** (IndexedDB). Uploads de um PC não aparecem automaticamente em outro — cada pessoa atualiza a KSB1 no seu notebook, ou o time combina um único PC “oficial” para a gestão.
