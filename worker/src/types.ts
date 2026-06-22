export type LicenseStatus = 'active' | 'grace' | 'suspended';
export type Override = 'none' | 'force_active' | 'force_suspended';

export interface ClientRecord {
  dominio: string;
  asaas_customer_id: string;
  asaas_subscription_id: string;
  override: Override;
}

export interface Manifest {
  v: 1;
  key: string;          // sha256(dominio) hex
  status: LicenseStatus;
  paid_through: string; // YYYY-MM-DD
  grace_until: string;  // YYYY-MM-DD
  issued_at: string;    // ISO 8601
  expires_at: string;   // ISO 8601
  kid: string;
  sig?: string;         // base64 Ed25519
}

// ───────────── Portal do Revendedor / licença por seat ─────────────

export type Plano = 'pago' | 'cortesia';

export interface Reseller {
  id: string;                  // reseller_id (embutido no build whitelabel)
  asaas_subscription_id: string;
  plano_cota: number;          // nº de instalações ativas permitidas
  status: LicenseStatus;       // active | grace | suspended (do Asaas)
  kid: string;
  plano?: Plano;               // 'cortesia' = licença free/personalizada: cota ilimitada + isenta de cobrança (default 'pago')
}

export interface Seat {
  reseller_id: string;
  user_id: string;             // usuário autenticado no Mega
  device_id: string;           // install_id gerado no device
  first_seen: string;          // ISO 8601
  last_seen: string;           // ISO 8601
}
