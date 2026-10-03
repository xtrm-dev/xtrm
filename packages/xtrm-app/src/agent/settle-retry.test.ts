import { describe, expect, it, vi } from "vitest";
import { BusyError } from "../adapters/agent/types.ts";
import { MAX_RETRIES, RETRY_DELAY_MS, submitAfterSettle } from "./settle-retry.ts";

const busyTimes = (n: number) => {
  let calls = 0;
  return vi.fn(async () => {
    calls += 1;
    if (calls <= n) throw new BusyError();
  });
};

describe("submitAfterSettle (XTRM-601 busy right after a settle)", () => {
  const sleep = vi.fn(async () => {});

  it("retries a busy idle prompt quietly when the session settled under 3 s ago", async () => {
    const send = busyTimes(2);
    const waits: number[] = [];
    const r = await submitAfterSettle(send, { settledAt: 10_000, now: () => 11_500, sleep, onWait: (n) => waits.push(n) });
    expect(r).toEqual({ retries: 2 });
    expect(send).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([1, 2]);
    expect(sleep).toHaveBeenCalledWith(RETRY_DELAY_MS);
  });

  it("gives up after 3 retries: a session that is really working gets the busy answer", async () => {
    const send = busyTimes(10);
    await expect(submitAfterSettle(send, { settledAt: 10_000, now: () => 10_100, sleep })).rejects.toBeInstanceOf(BusyError);
    expect(send).toHaveBeenCalledTimes(MAX_RETRIES + 1);
  });

  it("does not retry when the settle is older than 3 s or unknown", async () => {
    for (const settledAt of [10_000, null]) {
      const send = busyTimes(1);
      await expect(submitAfterSettle(send, { settledAt, now: () => 13_000, sleep })).rejects.toBeInstanceOf(BusyError);
      expect(send).toHaveBeenCalledTimes(1);
    }
  });

  it("never retries other errors", async () => {
    const send = vi.fn(async () => {
      throw new Error("rejected");
    });
    await expect(submitAfterSettle(send, { settledAt: 10_000, now: () => 10_100, sleep })).rejects.toThrow("rejected");
    expect(send).toHaveBeenCalledTimes(1);
  });
});
