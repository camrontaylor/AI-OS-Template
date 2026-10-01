import crypto from "node:crypto";

export interface SecretCiphertext {
  encryptedValue: string;
  encryptionKeyId: string;
  nonce: string;
  authTag: string;
  valueSha256: string;
}

export class SecretCryptoError extends Error {
  readonly code = "secret_crypto_unavailable";
  constructor(message: string) {
    super(message);
    this.name = "SecretCryptoError";
  }
}

interface SecretKey {
  id: string;
  key: Buffer;
}

const KEY_PAIR_SEPARATOR = ":";
const KEY_ENTRY_SEPARATOR = ",";

function decodeKey(value: string): Buffer {
  const normalized = value.trim();
  const decoded = Buffer.from(normalized, "base64url");
  if (decoded.length !== 32) {
    throw new SecretCryptoError("TEAM_OS_SECRETS_KEYS must contain 32-byte base64url keys");
  }
  return decoded;
}

function parseKeys(env: NodeJS.ProcessEnv = process.env): Map<string, SecretKey> {
  const raw = (env.TEAM_OS_SECRETS_KEYS ?? "").trim();
  if (!raw) {
    throw new SecretCryptoError("TEAM_OS_SECRETS_KEYS is required for TeamOS secrets");
  }
  const keys = new Map<string, SecretKey>();
  for (const entry of raw.split(KEY_ENTRY_SEPARATOR)) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const index = trimmed.indexOf(KEY_PAIR_SEPARATOR);
    if (index <= 0) {
      throw new SecretCryptoError("TEAM_OS_SECRETS_KEYS entries must use keyId:base64urlKey");
    }
    const id = trimmed.slice(0, index).trim();
    if (!/^[A-Za-z0-9._-]+$/.test(id)) {
      throw new SecretCryptoError("TEAM_OS_SECRETS_KEYS key IDs may use letters, numbers, dot, underscore, and dash");
    }
    keys.set(id, { id, key: decodeKey(trimmed.slice(index + 1)) });
  }
  if (keys.size === 0) {
    throw new SecretCryptoError("TEAM_OS_SECRETS_KEYS does not contain any usable keys");
  }
  return keys;
}

function activeKey(env: NodeJS.ProcessEnv = process.env): SecretKey {
  const keys = parseKeys(env);
  const explicit = (env.TEAM_OS_SECRETS_ACTIVE_KEY_ID ?? "").trim();
  if (explicit) {
    const key = keys.get(explicit);
    if (!key) throw new SecretCryptoError("TEAM_OS_SECRETS_ACTIVE_KEY_ID is not present in TEAM_OS_SECRETS_KEYS");
    return key;
  }
  if (keys.size === 1) return Array.from(keys.values())[0];
  throw new SecretCryptoError("TEAM_OS_SECRETS_ACTIVE_KEY_ID is required when multiple secret keys are configured");
}

function keyById(keyId: string, env: NodeJS.ProcessEnv = process.env): SecretKey {
  const key = parseKeys(env).get(keyId);
  if (!key) throw new SecretCryptoError(`secret encryption key ${keyId} is not configured`);
  return key;
}

export function encryptSecretValue(value: string, env: NodeJS.ProcessEnv = process.env): SecretCiphertext {
  const active = activeKey(env);
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", active.key, nonce);
  const encrypted = Buffer.concat([cipher.update(value, "utf-8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encryptedValue: encrypted.toString("base64url"),
    encryptionKeyId: active.id,
    nonce: nonce.toString("base64url"),
    authTag: authTag.toString("base64url"),
    valueSha256: crypto.createHash("sha256").update(value, "utf-8").digest("hex"),
  };
}

export function decryptSecretValue(ciphertext: SecretCiphertext, env: NodeJS.ProcessEnv = process.env): string {
  const key = keyById(ciphertext.encryptionKeyId, env);
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key.key,
    Buffer.from(ciphertext.nonce, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(ciphertext.authTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext.encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf-8");
}
