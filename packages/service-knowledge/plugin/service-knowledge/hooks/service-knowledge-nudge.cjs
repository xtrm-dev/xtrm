#!/usr/bin/env node
/**
 * Fast, advisory service-knowledge context nudge for Claude Code PreToolUse.
 *
 * Reads only the registry (never service source), caches the parsed registry per session, names at
 * most three services the current call touches, once per service per session, and always exits
 * successfully so a broken registry cannot block a tool call.
 *
 * The text this hook emits is byte-identical to the text the pi extension appends to a tool result,
 * so an operator reading either host sees the same advice. Keep the two in step.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const TOOLS = new Set(['Read', 'Grep', 'Glob', 'Bash']);
const READ_COMMAND = /^(?:cat|head|tail|sed|awk|rg|grep|find|fd|ls)(?:\s|$)/;
const RESERVED = new Set(['default', 'optional', 'user', 'active', 'local-legacy']);
const UMBRELLAS = ['service-knowledge', 'service-skills'];
/** One injection names a few services, not a wall of territory. */
const MAX_SERVICES = 3;
const ACTIVATOR = 'skill_activator.py';

function readInput() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8')); } catch { return {}; }
}

function ancestors(start) {
  const result = [];
  let current = path.resolve(start || process.cwd());
  for (let i = 0; i < 6; i += 1) {
    result.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return result;
}

function findPacks(cwd) {
  const packs = [];
  const seen = new Set();
  for (const base of ancestors(cwd)) {
    for (const root of [path.join(base, '.xtrm', 'skills'), path.join(base, '.xtrm', 'skills', 'user', 'packs')]) {
      let names;
      try { names = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(); } catch { continue; }
      for (const name of names) {
        if (RESERVED.has(name)) continue;
        const packDir = path.join(root, name);
        if (seen.has(packDir)) continue;
        for (const umbrella of UMBRELLAS) {
          const registryPath = path.join(packDir, umbrella, 'service-registry.json');
          if (!fs.existsSync(registryPath)) continue;
          seen.add(packDir);
          packs.push({ packDir, registryPath });
          break;
        }
      }
    }
  }
  return packs;
}

/**
 * Per-session, per-checkout snapshot of everything the nudge reads from disk: the parsed registry
 * and whether this repo wires the older per-repo activator. Both are stable for a session, so one
 * cache file keeps the hook inside its wall-clock budget and keeps a settings read off the hot path.
 */
function loadState(cwd, sessionId) {
  const id = String(sessionId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  const key = `${id}-${Buffer.from(path.resolve(cwd || process.cwd())).toString('base64url').slice(0, 32)}`;
  const cachePath = path.join(os.tmpdir(), `service-knowledge-nudge-${key}.json`);
  try {
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (cached && Array.isArray(cached.packs)) return { packs: cached.packs, activator: Boolean(cached.activator) };
  } catch { /* cache miss */ }
  const packs = findPacks(cwd).flatMap((pack) => {
    try {
      const raw = JSON.parse(fs.readFileSync(pack.registryPath, 'utf8'));
      return raw && raw.services && typeof raw.services === 'object' ? [{ ...pack, services: raw.services }] : [];
    } catch { return []; }
  });
  const state = { packs, activator: detectActivator(cwd) };
  try { fs.writeFileSync(cachePath, JSON.stringify(state), { mode: 0o600 }); } catch { /* fail open */ }
  return state;
}

function loadPacks(cwd, sessionId) { return loadState(cwd, sessionId).packs; }

/**
 * True when the repo wires the older per-repo activator, which already injects a full evidence
 * bundle on the same PreToolUse events. Two hooks answering one Read is noise, and the bundle is
 * the better answer, so this hook stays silent there instead of racing it.
 */
function detectActivator(cwd) {
  const bases = [process.env.CLAUDE_PROJECT_DIR, cwd].filter(Boolean);
  for (const base of bases) {
    try {
      if (fs.readFileSync(path.join(base, '.claude', 'settings.json'), 'utf8').includes(ACTIVATOR)) return true;
    } catch { /* no settings file */ }
  }
  return false;
}

/** Without a session id the answer is computed, not cached; the hook always passes one. */
function activatorWired(cwd, sessionId) {
  if (sessionId === undefined) return detectActivator(cwd);
  return loadState(cwd, sessionId).activator;
}

function normalize(value) { return String(value).replaceAll('\\', '/').replace(/^\.\//, ''); }
function rootFor(cwd) {
  try { return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', timeout: 50, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || cwd; } catch { return cwd; }
}
function fnmatchRegex(pattern) {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\\\*/g, '.*').replace(/\\\?/g, '.')}$`);
}
function relativePath(filePath, root) {
  let rel = normalize(filePath);
  const base = normalize(root);
  if (rel.startsWith(`${base}/`)) rel = rel.slice(base.length + 1);
  return rel;
}
// Mirror of match_territory() in service_knowledge/scripts/skill_activator.py, one pattern against
// one root-relative path, so the plugin and the Python activator resolve the same territory.
function patternMatches(rel, raw) {
  const pattern = normalize(raw);
  try {
    if (pattern.includes('**')) {
      const parts = pattern.split('**/');
      if (parts.length === 2) {
        const [prefix, suffix] = parts;
        const relCheck = rel.startsWith(prefix) ? rel.slice(prefix.length) : rel;
        if (fnmatchRegex(suffix).test(relCheck) || fnmatchRegex(`${prefix}*/${suffix}`).test(rel)) return true;
        if (prefix && rel.startsWith(prefix.replace(/\/+$/, ''))) return true;
      }
    } else if (fnmatchRegex(pattern).test(rel)) {
      return true;
    }
    const base = pattern.split('/*')[0].split('/**')[0];
    return Boolean(base) && (rel.startsWith(`${base}/`) || rel === base);
  } catch { return false; }
}
// Ownership, not merely "python's matcher said yes": a pattern `dir/**/*` also matches a path
// outside `dir` through the suffix branch of match_territory. That branch is the gate's business,
// not the nudge's, so a nudge only names a service whose pattern really covers the path.
// How specific a matched pattern is: an exact path (3) beats a named file (2) beats a directory or
// wildcard family (1). `api/mcp_server.py` is a better answer than `api/**/*.py`, and naming the
// better answer keeps the nudge short and correct when territories overlap.
function strictScore(rel, raw) {
  const pattern = normalize(raw);
  if (!pattern.includes('*') && !pattern.includes('?')) return rel === pattern ? 3 : 0;
  const name = pattern.split('/').pop() || '';
  const named = Boolean(name.replace(/[*?]/g, ''));
  let owned = false;
  const parts = pattern.split('**/');
  if (pattern.includes('**') && parts.length === 2) {
    const [prefix, suffix] = parts;
    if (!prefix) {
      owned = fnmatchRegex(`*/${suffix}`).test(rel);
    } else {
      if (rel.startsWith(prefix)) owned = fnmatchRegex(suffix).test(rel.slice(prefix.length));
      if (!owned) owned = fnmatchRegex(`${prefix}*/${suffix}`).test(rel);
    }
  } else if (fnmatchRegex(pattern).test(rel)) {
    owned = true;
  }
  const base = pattern.split('/*')[0].split('/**')[0];
  if (!owned && base && (rel === base || rel.startsWith(`${base}/`))) owned = true;
  if (!owned) return 0;
  return named ? 2 : 1;
}
/**
 * A Grep or Glob path can be a directory. Then a service owns the call when its territory lies
 * under that directory, even though no single pattern matches the bare directory name.
 */
function directoryOwned(rel, territory) {
  const dir = rel.replace(/\/+$/, '');
  for (const raw of Array.isArray(territory) ? territory : []) {
    if (typeof raw !== 'string' || !raw) continue;
    const base = normalize(raw).split('/*')[0].split('/**')[0];
    // Only a pattern with a literal base inside the directory is ownership. The parity matcher's
    // suffix branch would also match here, and that is exactly the noise this rule exists to stop.
    if (base && base.startsWith(`${dir}/`)) return true;
  }
  return false;
}
function territoryScore(filePath, territory, root) {
  if (!Array.isArray(territory) || typeof filePath !== 'string') return 0;
  const rel = relativePath(filePath, root);
  let best = 0;
  for (const raw of territory) {
    if (typeof raw !== 'string' || !raw) continue;
    best = Math.max(best, strictScore(rel, raw));
  }
  return best;
}
/** True when the token names a directory, so a territory underneath it counts as owned. */
function looksLikeDirectory(rel, root) {
  const base = rel.split('/').pop() || '';
  if (!base.includes('.')) return true;
  try { return fs.statSync(path.join(root, rel)).isDirectory(); } catch { return false; }
}
// Exact boolean parity with the Python activator, quirks included, for the parity test.
function matches(filePath, territory, cwd) {
  if (!Array.isArray(territory) || typeof filePath !== 'string') return false;
  return territory.some((raw) => typeof raw === 'string' && raw && patternMatches(relativePath(filePath, rootFor(cwd)), raw));
}
// A sed script is not a path: `1,5p`, `$d` and `s/a/b/g` must not reach the territory matcher.
const SED_SCRIPT = /^(?:\d+(?:,\d+)?[a-zA-Z]?|[0-9$][0-9,$]*[a-zA-Z]{1,2}|s([/#|]).*\1.*)$/;
function commandPaths(command) {
  if (!READ_COMMAND.test(String(command || '').trim())) return [];
  const tokens = String(command).match(/(?:'[^']*'|"[^"]*"|[^\s;&|]+)/g) || [];
  return tokens
    .slice(1)
    .map((token) => token.replace(/^['"]|['"]$/g, ''))
    .filter((token) => token && !token.startsWith('-') && !SED_SCRIPT.test(token));
}
function pathsFor(input) {
  const tool = input.tool_name;
  const data = input.tool_input || {};
  if (tool === 'Read') return [data.file_path || data.path].filter((value) => typeof value === 'string');
  if (tool === 'Grep' || tool === 'Glob') return [data.path, data.file_path].filter((value) => typeof value === 'string');
  if (tool === 'Bash') return commandPaths(data.command);
  return [];
}
function markerPresent(cwd) {
  return ancestors(cwd).some((base) => fs.existsSync(path.join(base, '.xtrm', '.service-knowledge-drift-pending')) || fs.existsSync(path.join(base, '.xtrm', '.service-skills-drift-pending')));
}
/**
 * The most specific un-nudged services for these paths, at most MAX_SERVICES. A tie keeps every
 * co-owner, so the message never pretends one service owns territory that two services share.
 */
function bestMatches(packs, paths, root, seen) {
  const scored = [];
  for (const pack of packs) for (const [id, info] of Object.entries(pack.services || {})) {
    if (seen.has(id)) continue;
    const bucket = new Set();
    let score = 0;
    for (const filePath of paths) {
      const rel = relativePath(filePath, root);
      const own = territoryScore(filePath, info.territory, root);
      if (own > 0) { score = Math.max(score, own); bucket.add(rel); }
      else if (looksLikeDirectory(rel, root) && directoryOwned(rel, info.territory)) { score = Math.max(score, 1); bucket.add(rel); }
    }
    if (score > 0) scored.push({ id, info, score, files: [...bucket] });
  }
  if (!scored.length) return [];
  scored.sort((left, right) => right.score - left.score);
  return scored.filter((service) => service.score === scored[0].score).slice(0, MAX_SERVICES);
}
function nextCall(service) {
  const payload = JSON.stringify({ paths: service.files });
  const skill = service.info && typeof service.info.skill_path === 'string' ? service.info.skill_path : null;
  return skill
    ? `Next: knowledge_evidence_for_files ${payload}, or knowledge_get with skill_path ${skill}.`
    : `Next: knowledge_evidence_for_files ${payload}, or knowledge_get ${service.id}.`;
}
function buildMessage(selected, cwd) {
  const drift = markerPresent(cwd) ? 'Drift is pending: run knowledge_drift before trusting this knowledge.' : '';
  if (selected.length === 1) {
    const service = selected[0];
    const owner = `${service.id} owns ${service.files.join(', ')}. ${nextCall(service)}`;
    return `[service-knowledge] ${owner}${drift ? ` ${drift}` : ''}`;
  }
  const lines = [`[service-knowledge] ${selected.length} services own these paths:`];
  for (const service of selected) lines.push(`- ${service.id} owns ${service.files.join(', ')}. ${nextCall(service)}`);
  if (drift) lines.push(drift);
  return lines.join('\n');
}
function nudge(input) {
  if (!input || input.hook_event_name !== 'PreToolUse' || !TOOLS.has(input.tool_name)) return '';
  const cwd = input.cwd || process.cwd();
  const state = loadState(cwd, input.session_id);
  if (!state.packs.length) return '';
  if (state.activator) return '';
  const paths = pathsFor(input);
  if (!paths.length) return '';
  const sessionKey = String(input.session_id || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  const seenPath = path.join(os.tmpdir(), `service-knowledge-nudge-seen-${sessionKey}`);
  let seen = new Set();
  try { seen = new Set(fs.readFileSync(seenPath, 'utf8').split('\n').filter(Boolean)); } catch { /* first call */ }
  const root = rootFor(cwd);
  const selected = bestMatches(state.packs, paths, root, seen);
  if (!selected.length) return '';
  for (const service of selected) seen.add(service.id);
  try { fs.writeFileSync(seenPath, `${[...seen].join('\n')}\n`, { mode: 0o600 }); } catch { /* fail open */ }
  return buildMessage(selected, cwd);
}
function main() {
  try {
    const message = nudge(readInput());
    if (message) process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: message } })}\n`);
  } catch { /* never block */ }
}

module.exports = { nudge, matches, territoryScore, directoryOwned, pathsFor, commandPaths, findPacks, loadPacks, loadState, activatorWired, MAX_SERVICES };
if (require.main === module) main();
