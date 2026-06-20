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
