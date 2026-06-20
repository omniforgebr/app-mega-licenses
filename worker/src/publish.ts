import { buildManifest } from './manifest';
import { signManifest, importPrivateKey } from './sign';
import { fetchSubscriptionPayments, latestPaidThrough } from './asaas';
import { putFile, purgeJsdelivr } from './github';
import type { ClientRecord } from './types';

export interface Env {
  LICENSES: KVNamespace;
  SIGNING_KEY: string;        // pkcs8 base64 (Secret)
  GITHUB_TOKEN: string;       // Secret
  GITHUB_REPO: string;        // "omniforge/app-mega-licenses"
  ASAAS_API_KEY: string;      // Secret
  ASAAS_WEBHOOK_TOKEN: string;// Secret
  ADMIN_TOKEN: string;        // Secret (factory /admin -> worker)
  MEGA_WORKER_SECRET: string; // Secret (login do Mega -> worker, rotas de seat)
  KID: string;                // var
}

// I4: cache the imported private key at module level so the cron job doesn't
// re-import 50× (once per client) — importKey is expensive on the crypto layer.
let _priv: CryptoKey | undefined;
async function getPrivateKey(env: Env): Promise<CryptoKey> {
  return (_priv ??= await importPrivateKey(env.SIGNING_KEY));
}

export async function reissueClient(env: Env, rec: ClientRecord, now: Date): Promise<void> {
  const payments = await fetchSubscriptionPayments(env.ASAAS_API_KEY, rec.asaas_subscription_id);
  const paidThrough = latestPaidThrough(payments);
  const manifest = await buildManifest({ dominio: rec.dominio, paidThrough, override: rec.override, now, kid: env.KID });
  const signed = await signManifest(manifest, await getPrivateKey(env));
  const path = `licenses/${signed.key}.json`;
  await putFile(env.GITHUB_REPO, path, JSON.stringify(signed, null, 2), env.GITHUB_TOKEN);
  await purgeJsdelivr(env.GITHUB_REPO, path);
}
