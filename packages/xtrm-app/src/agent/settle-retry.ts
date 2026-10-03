// Busy right after a settle (XTRM-601). The host can report a Frame settled while the Pi extension
// still answers a new prompt `busy` for a moment: Pi has not returned to idle yet. Until the extension's
// idle window is fixed in core, an idle prompt sent within SETTLE_WINDOW_MS of the settle that is
// answered busy is sent again, quietly, up to MAX_RETRIES times, RETRY_DELAY_MS apart; the composer
// shows "Waiting for the agent…" meanwhile. A session that is really working still answers busy after
// that, and the composer then offers steer or follow-up (PRD §35.8 item 5).
import { BusyError } from "../adapters/agent/types.ts";

export const SETTLE_WINDOW_MS = 3_000;
export const MAX_RETRIES = 3;
export const RETRY_DELAY_MS = 1_000;

export interface SettleRetryOptions {
  /** When this app last saw the session leave working (settled, failed, aborted); null if never. */
  settledAt: number | null;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Called before each quiet retry, with its number (1..MAX_RETRIES). */
  onWait?: (attempt: number) => void;
}

/** Sends an idle prompt; a busy answer right after a settle is retried quietly. Rethrows anything else. */
export async function submitAfterSettle(send: () => Promise<void>, opts: SettleRetryOptions): Promise<{ retries: number }> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const justSettled = opts.settledAt !== null && now() - opts.settledAt < SETTLE_WINDOW_MS;
  for (let retries = 0; ; retries++) {
    try {
      await send();
      return { retries };
    } catch (e) {
      if (!(e instanceof BusyError) || !justSettled || retries >= MAX_RETRIES) throw e;
      opts.onWait?.(retries + 1);
      await sleep(RETRY_DELAY_MS);
    }
  }
}
