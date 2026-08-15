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

// Deliberately not in STORAGE_DEFAULTS: the snapshot can hold thousands of cookies, and
// getConfig() runs on every auth challenge. It is read explicitly, only when needed.
export const SNAPSHOT_KEY = "cookieSnapshot";

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

export async function readInstanceState() {
  return INSTANCE_AREA.get(INSTANCE_DEFAULTS);
}
