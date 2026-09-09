// C15 race participant: opens its own WAL connection and attempts one
// claim. Exit 0 won, 2 lost-the-race (or not-claimable), 1 unexpected error.
// Run concurrently from claims-leases.test.ts via child processes.
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";

const [, , dbPath, issueId, holder] = process.argv;
const db = openSubstrate(dbPath as string);
try {
  const svc = new IssueService(db);
  svc.claimIssue(issueId as string, holder as string, { activationId: `act-${holder}` });
  process.exit(0);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (/claim-held|not-claimable|revision conflict/.test(msg)) process.exit(2);
  console.error(`racer ${holder} unexpected: ${msg}`);
  process.exit(1);
} finally {
  db.close();
}
