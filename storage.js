// Canonical shape of chrome.storage.local. The service worker and the popup both read
// through this, so the two can't drift apart.
//
// Passing this object to storage.local.get() both selects the keys and supplies the
// defaults for any that are unset.
export const STORAGE_DEFAULTS = {
  sessions: [],
  domains: [],
  activeByDomain: {},
  selectedDomain: null,
  preemptive: false,
  seenChallenges: []
};

// Diagnostics, not configuration: they describe what happened in *this* profile instance,
// so a private window's must not be written to shared, on-disk storage.local.
export const INSTANCE_DEFAULTS = {
  lastScheme: null,
  ruleError: null,
  lastReset: null,
  insecureHost: null
};

// ---- Profile isolation -----------------------------------------------------

// The manifest asks for split incognito, so Chrome runs a second, independent instance of
// this extension for private windows. The two instances share storage.local but NOT
// storage.session — so anything that must not cross the profile boundary is read and
// written through INSTANCE_AREA rather than storage.local directly.
//
// What stays shared on purpose: the user list, the domain list, and the settings. Those are
// configuration, and having to re-add every user in a private window would be absurd.
export const IS_INCOGNITO = chrome.extension?.inIncognitoContext === true;

export const INSTANCE_AREA = IS_INCOGNITO ? chrome.storage.session : chrome.storage.local;

// A private window opens on whatever user the normal profile is signed in as, and diverges
// from there. Seeding beats starting on "Nobody": the common case is wanting a *second*
// user alongside the current one, not a blank slate.
export async function readActiveByDomain() {
  if (!IS_INCOGNITO) {
    return (await chrome.storage.local.get({ activeByDomain: {} })).activeByDomain;
  }
  const { activeByDomain } = await chrome.storage.session.get("activeByDomain");
  if (activeByDomain) return activeByDomain;

  const seed = (await chrome.storage.local.get({ activeByDomain: {} })).activeByDomain;
  await chrome.storage.session.set({ activeByDomain: seed });
  return seed;
}

export async function writeActiveByDomain(activeByDomain) {
  await INSTANCE_AREA.set({ activeByDomain });
}

// The Panel's one way to save a change to users or sites (architecture §4). activeByDomain goes
// first: if the second write fails, a site is left with nobody signed in rather than with a
// signed-in user who has lost the right to it. sessions and domains share one set() so a save
// writes sessions exactly once (spec R7, R14).
export async function writeChange({ activeByDomain, sessions, domains }) {
  if (activeByDomain !== undefined) await writeActiveByDomain(activeByDomain);
  const config = {};
  if (sessions !== undefined) config.sessions = sessions;
  if (domains !== undefined) config.domains = domains;
  if (Object.keys(config).length) await chrome.storage.local.set(config);
}

export async function readInstanceState() {
  return INSTANCE_AREA.get(INSTANCE_DEFAULTS);
}
