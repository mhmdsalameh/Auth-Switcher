// Export/import of users and domains. Kept free of DOM and chrome.* so the crypto and
// merge logic can be tested directly — a backup that cannot be re-imported is worthless.

export const FORMAT = "auth-switcher";
// Files written before the rename. Still readable — a rename must not orphan someone's backup.
const LEGACY_FORMATS = ["k2-multi-session"];
const KDF_ITERATIONS = 600_000;

// The domain list decides where passwords get sent, so everything entering it is normalized
// the same way — typed by hand or read out of a file nobody authenticated.
export function normalizeDomain(line) {
  return String(line ?? "")
    .trim()
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .toLowerCase();
}

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(passphrase, salt, iterations) {
  const base = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// Ids are deliberately dropped: they are regenerated on import so a file can be imported
// into an install that already has users without colliding.
function toPayload({ domains, sessions }) {
  return {
    domains: [...domains],
    sessions: sessions.map(({ id, ...rest }) => rest)
  };
}

export async function buildBackup(state, passphrase) {
  const payload = toPayload(state);
  if (!passphrase) {
    return { format: FORMAT, version: 1, encrypted: false, payload };
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, KDF_ITERATIONS);
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(payload))
  );

  return {
    format: FORMAT,
    version: 1,
    encrypted: true,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: KDF_ITERATIONS, salt: b64(salt) },
    iv: b64(iv),
    data: b64(data)
  };
}

export function parseBackup(text) {
  let file;
  try {
    file = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  if (file?.format !== FORMAT && !LEGACY_FORMATS.includes(file?.format)) {
    throw new Error("That isn't an Auth Switcher backup.");
  }
  if (file.version !== 1) throw new Error(`Backup version ${file.version} isn't supported.`);
  return file;
}

export async function openBackup(file, passphrase) {
  if (!file.encrypted) return file.payload;
  if (!passphrase) throw new Error("This backup needs a passphrase.");

  let plain;
  try {
    const key = await deriveKey(passphrase, unb64(file.kdf.salt), file.kdf.iterations);
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(file.iv) }, key, unb64(file.data)
    );
  } catch {
    // AES-GCM fails its auth tag on a wrong key, so this is the expected path.
    throw new Error("Wrong passphrase.");
  }
  return JSON.parse(new TextDecoder().decode(plain));
}

const identity = (s) => `${s.domain}\u0000${s.username}`;

// Merges rather than replaces, so importing onto a populated install is non-destructive.
// A user already present for the same domain and username is skipped.
export function mergeBackup(current, payload, newId = () => crypto.randomUUID()) {
  const incoming = (payload?.sessions ?? [])
    .filter((s) => s?.domain && s?.username && s?.name)
    .map((s) => ({ ...s, domain: normalizeDomain(s.domain) }))
    .filter((s) => s.domain);

  const domains = [...new Set([
    ...current.domains,
    ...(payload?.domains ?? []).map(normalizeDomain),
    ...incoming.map((s) => s.domain)
  ].filter(Boolean))];

  const seen = new Set(current.sessions.map(identity));
  const added = [];
  for (const session of incoming) {
    if (seen.has(identity(session))) continue;
    seen.add(identity(session));
    added.push({ ...session, id: newId() });
  }

  const sessions = [...current.sessions, ...added];
  const activeByDomain = { ...current.activeByDomain };
  for (const domain of domains) {
    if (activeByDomain[domain]) continue;
    const first = sessions.find((s) => s.domain === domain);
    if (first) activeByDomain[domain] = first.id;
  }

  return {
    domains,
    sessions,
    activeByDomain,
    added: added.length,
    skipped: incoming.length - added.length
  };
}
