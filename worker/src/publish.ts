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
  KID: string;                // var
}

export async function reissueClient(env: Env, rec: ClientRecord, now: Date): Promise<void> {
  const payments = await fetchSubscriptionPayments(env.ASAAS_API_KEY, rec.asaas_subscription_id);
  const paidThrough = latestPaidThrough(payments);
  const manifest = await buildManifest({ dominio: rec.dominio, paidThrough, override: rec.override, now, kid: env.KID });
  const signed = await signManifest(manifest, await importPrivateKey(env.SIGNING_KEY));
  const path = `licenses/${signed.key}.json`;
  await putFile(env.GITHUB_REPO, path, JSON.stringify(signed, null, 2), env.GITHUB_TOKEN);
  await purgeJsdelivr(env.GITHUB_REPO, path);
}
