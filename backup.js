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

// A user's credentials usually work on more than one site — k2.corp.com and
// k2test.corp.com are typically the same account — so `domains` is a list, not a string.
// v2 wrote a single `domain` instead; migrate() rewrites those on the next worker boot,
// but the popup can read storage before that happens, and an imported file can carry
// either shape. Everything reads through here rather than touching either field.
//
// Lives in this module because it is the one file with no DOM and no chrome.* — the
// worker, the popup and the backup code can all import it.
export function domainsOf(session) {
  if (Array.isArray(session?.domains)) return session.domains;
  return session?.domain ? [session.domain] : [];
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
//
// `domains` is the canonical field. A single `domain` is written alongside it so a file
// exported here still opens in a build that predates multi-domain users — that build reads
// `domain` and lands the user on the first site instead of all of them, which is a
// degraded import rather than a silently empty one. That backward compatibility is also
// why the file version stays at 1: the addition is purely additive.
function toPayload({ domains, sessions }) {
  return {
    domains: [...domains],
    sessions: sessions.map(({ id, domain, domains: owned, ...rest }) => {
      const list = domainsOf({ domain, domains: owned });
      return { ...rest, domains: list, domain: list[0] };
    })
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

// A user already here is one with the same username that already covers every site the
// incoming record names. Same username but a site not covered yet is genuinely new
// information, so it is added rather than dropped — otherwise re-importing a file after
// widening a user's sites on another machine would silently discard the widening.
function covered(existing, incoming) {
  if (existing.username !== incoming.username) return false;
  const mine = domainsOf(existing);
  return incoming.domains.every((d) => mine.includes(d));
}

// Merges rather than replaces, so importing onto a populated install is non-destructive.
export function mergeBackup(current, payload, newId = () => crypto.randomUUID()) {
  const incoming = (payload?.sessions ?? [])
    .map((s) => {
      if (!s?.username || !s?.name) return null;
      // Nothing in the file is trusted: every site name goes through the same sanitizer as
      // one typed by hand, because this list is what decides where passwords get sent.
      const domains = [...new Set(domainsOf(s).map(normalizeDomain).filter(Boolean))];
      if (!domains.length) return null;
      const { domain, ...rest } = s;
      return { ...rest, domains };
    })
    .filter(Boolean);

  const domains = [...new Set([
    ...current.domains,
    ...(payload?.domains ?? []).map(normalizeDomain),
    ...incoming.flatMap((s) => s.domains)
  ].filter(Boolean))];

  // Appended as we go, so two incoming records for the same user still dedupe against
  // each other and not just against what was already installed.
  const sessions = [...current.sessions];
  const added = [];
  for (const session of incoming) {
    if (sessions.some((existing) => covered(existing, session))) continue;
    const record = { ...session, id: newId() };
    sessions.push(record);
    added.push(record);
  }

  const activeByDomain = { ...current.activeByDomain };
  for (const domain of domains) {
    if (activeByDomain[domain]) continue;
    const first = sessions.find((s) => domainsOf(s).includes(domain));
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
