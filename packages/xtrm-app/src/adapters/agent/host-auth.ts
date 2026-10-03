// Direct-mode pairing wire types, mirrored by hand from @xtrm/contracts (xtrm-dev/core
// packages/contracts/schemas/xtrm.agent-host-auth.v1.json, origin/main 5f0734c9; XTRM-568, XTRM-599).
// Only the bodies this app sends or reads are typed: pair_request (POST /v1/pair) and its
// device_session answer. Pairing-token issue, device list and revoke answer local clients only and
// stay with `xt host pair|devices|revoke`. Errors keep the xtrm.agent-host-api.v1 `error` kind.

export const HOST_AUTH_SCHEMA = "xtrm.agent-host-auth.v1";

export interface HostDeviceSummary {
  deviceId: string;
  /** Sanitized by the host: control characters stripped, at most 64 characters, `device` when empty. */
  name: string;
  createdAt: number;
}

export interface HostPairRequest {
  schema: typeof HOST_AUTH_SCHEMA;
  kind: "pair_request";
  /** Single-use `xtp_…` token from `xt host pair`; expires within 10 minutes. */
  pairingToken: string;
  deviceName?: string;
}

export interface HostDeviceSession {
  schema: typeof HOST_AUTH_SCHEMA;
  kind: "device_session";
  device: HostDeviceSummary;
  /** 256-bit `xtd_…` bearer token, returned once. */
  token: string;
}

export const PAIRING_TOKEN_RE = /^xtp_[A-Za-z0-9_-]+$/;
export const DEVICE_TOKEN_RE = /^xtd_[A-Za-z0-9_-]+$/;
