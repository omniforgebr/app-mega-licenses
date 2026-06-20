# app-mega-licenses

Distribuição de licenças do app whitelabel OmniForge (Mega). Repositório **público** que serve, via CDN (jsDelivr + raw.githubusercontent), manifestos de licença **assinados com Ed25519** — um por cliente, em `licenses/<sha256(domínio)>.json`.

A confiança vem da **assinatura**, não do segredo do repositório: sem a chave privada (guardada num Cloudflare Worker Secret) ninguém forja um manifesto válido. Os arquivos **não contêm PII** — só hash do domínio, status e datas.

## Como funciona

- O **Worker** (`worker/`) recebe webhooks do Asaas e roda a cada 4h. Calcula o status (`active` / `grace` / `suspended`, carência de 5 dias), assina o manifesto e dá push aqui.
- O **app** baixa `licenses/<hash>.json`, verifica a assinatura com a chave pública embutida no build e libera/bloqueia. Funciona offline até `expires_at` (rédea de 14 dias).
- A gestão das ativações (mapa domínio↔Asaas, override manual) vive no Worker (KV) — não depende de VPS.

## Worker

TypeScript + Cloudflare Workers (Wrangler).

```bash
cd worker
npm install
npm test          # vitest
```

Deploy e secrets (`SIGNING_KEY`, `GITHUB_TOKEN`, `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN`, `ADMIN_TOKEN`): ver `worker/wrangler.toml` e `worker/.dev.vars.example`.

Spec completa: repositório `app_mega`, `docs/superpowers/specs/2026-06-20-apk-license-system-design.md`.
