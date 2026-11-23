// Bulk changes to which users can sign in to which sites, as pure transforms (ADR 0003).
// No chrome.*, no DOM: the Panel persists what these return, in one save (spec R14).
//
// `state` is { sessions, domains, activeByDomain }. Inputs are never mutated; a user the
// change does not touch is returned as the same object.

import { normalizeDomain, domainsOf } from "./backup.js";

const siteSet = (sites) => new Set(sites.map(normalizeDomain).filter(Boolean));

// The stored shape is `domains`; a legacy `domain` is dropped whenever a record is rewritten
// so the two can never disagree.
function withSites(session, domains) {
  const { domain: _legacy, ...rest } = session;
  return { ...rest, domains };
}

// Adds sites; never removes any, stale ones included (R1). Only configured sites are applied,
// the rest come back in `notApplied` (R2). Never names a signed-in user (R3).
export function linkUsers(state, userIds, sites) {
  const wanted = siteSet(sites);
  const apply = state.domains.filter((d) => wanted.has(d));
  const notApplied = [...wanted].filter((d) => !state.domains.includes(d));
  const ids = new Set(userIds);

  const sessions = state.sessions.map((s) => {
    if (!ids.has(s.id)) return s;
    const current = domainsOf(s);
    const add = apply.filter((d) => !current.includes(d));
    return add.length ? withSites(s, [...current, ...add]) : s;
  });
  return { sessions, notApplied };
}

// Removes sites (R4). `orphans` are the chosen users this would leave with no configured site
// (R5); `deleteOrphans` decides whether they are deleted or left exactly as they were (R6).
// A site whose signed-in user loses it, or is deleted, is left with nobody (R7).
export function unlinkUsers(state, userIds, sites, { deleteOrphans = false } = {}) {
  const drop = siteSet(sites);
  const ids = new Set(userIds);
  const orphans = [];
  const changed = new Map();

  for (const s of state.sessions) {
    if (!ids.has(s.id)) continue;
    const current = domainsOf(s);
    const next = current.filter((d) => !drop.has(d));
    if (next.length === current.length) continue;
    if (!next.some((d) => state.domains.includes(d))) orphans.push(s.id);
    changed.set(s.id, next);
  }

  const removed = new Set(deleteOrphans ? orphans : []);
  const kept = new Set(deleteOrphans ? [] : orphans);
  const sessions = state.sessions
    .filter((s) => !removed.has(s.id))
    .map((s) => (changed.has(s.id) && !kept.has(s.id) ? withSites(s, changed.get(s.id)) : s));

  const activeByDomain = { ...(state.activeByDomain ?? {}) };
  for (const [site, id] of Object.entries(activeByDomain)) {
    if (removed.has(id)) delete activeByDomain[site];
    else if (changed.has(id) && !kept.has(id) && !changed.get(id).includes(site)) delete activeByDomain[site];
  }
  return { sessions, activeByDomain, orphans };
}

// Removes the users and every site they were signed in on (R7, R12).
export function deleteUsers(state, userIds) {
  const ids = new Set(userIds);
  const sessions = state.sessions.filter((s) => !ids.has(s.id));
  const activeByDomain = Object.fromEntries(
    Object.entries(state.activeByDomain ?? {}).filter(([, id]) => !ids.has(id))
  );
  return { sessions, activeByDomain };
}

// Configures a site and links the chosen users to it in the same result (R11). Nobody is
// signed in to it afterwards (R3).
export function addSiteWithUsers(state, site, userIds) {
  const name = normalizeDomain(site);
  if (!name) return { domains: state.domains, sessions: state.sessions };
  const domains = state.domains.includes(name) ? state.domains : [...state.domains, name];
  const { sessions } = linkUsers({ ...state, domains }, userIds, [name]);
  return { domains, sessions };
}
