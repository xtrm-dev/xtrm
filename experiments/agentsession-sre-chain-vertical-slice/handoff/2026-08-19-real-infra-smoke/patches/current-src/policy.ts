/**
 * Read-only sre_exec allow/deny policy — extracted so tests can import it
 * without pulling the Pi SDK. Consumed by src/tools/index.ts and by
 * tests/sre-exec-authority.test.ts.
 *
 * These are POSIX-shell-line matchers, not sandboxes. See §12 in the spec
 * and §5 of the experiment report for the explicit "experiment policy vs
 * production sandbox" distinction.
 */

export const DEFAULT_SRE_ALLOWLIST: RegExp[] = [
  /^git\s+(log|show|diff|status|blame|branch|tag|remote|rev-parse|shortlog|ls-files|cat-file|reflog|describe)\b/,
  /^cat\s+/,
  /^head\s+/,
  /^tail\s+/,
  /^less\s+/,
  /^wc\s+/,
  /^grep\s+/,
  /^rg\s+/,
  /^find\s+/,
  /^ls\s+/,
  /^stat\s+/,
  /^tree\s+/,
  /^du\s+/,
  /^df\s+/,
  /^file\s+/,
  /^readlink\s+/,
  /^docker\s+(ps|inspect|stats|logs|images|version|info|top|events|context|network\s+(inspect|ls))/,
  /^docker\s+compose\s+(ps|config|logs|images|top|version)/,
  /^systemctl\s+(status|show|list-units|list-timers|is-active|is-enabled)/,
  /^journalctl\s+(--no-pager|-u\s+|--since\s+|--until\s+)/,
  /^ss\s+/,
  /^ip\s+(a|addr|link|route|neigh|-s\s+)/,
  /^ps\s+/,
  /^top\s+-b/,
  /^free\s+/,
  /^uptime$/,
  /^uname\s+/,
  /^env$/,
  /^printenv\s+/,
  /^bd\s+(list|show|status|children|comments|history|graph|search|query|count)\b/,
  /^mcpq\s+/,
  /^sp\s+(list|view|config)\b/,
];

export const DEFAULT_SRE_DENYLIST: RegExp[] = [
  /(^|[;&|`(])\s*(rm|mv|cp|dd|mkfs|shred|truncate)\b/,
  /(^|[;&|`(])\s*(git\s+(push|reset|checkout\s+-|clean|rebase|commit|merge|apply|am|cherry-pick|revert|update-ref|branch\s+-D|branch\s+--delete))/,
  /(^|[;&|`(])\s*(docker\s+(rm|kill|stop|start|restart|update|pause|unpause|prune|system\s+prune|volume\s+(rm|prune)|network\s+(rm|prune)|image\s+(rm|prune)))/,
  /(^|[;&|`(])\s*(sudo|su|chmod|chown|setfacl|mount|umount|iptables|nft|nftables)/,
  />\s*[^&\s]/, // stdout redirect to file
  />>\s*[^&\s]/,
  /(^|[;&|`(])\s*(systemctl\s+(start|stop|restart|reload|enable|disable|mask|unmask))/,
  /(^|[;&|`(])\s*(bd\s+(update|create|q|close|reopen|delete|note|comment|dep|assign|priority|link|edit))/,
];
