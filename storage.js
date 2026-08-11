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
  lastScheme: null,
  ruleError: null,
  lastReset: null,
  seenChallenges: []
};

// Deliberately not in STORAGE_DEFAULTS: the snapshot can hold thousands of cookies, and
// getConfig() runs on every auth challenge. It is read explicitly, only when needed.
export const SNAPSHOT_KEY = "cookieSnapshot";
