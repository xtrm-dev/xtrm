import { describe, expect, it } from "vitest";
import { ContextMeter, contextLabel } from "./meta.tsx";

// XTRM-612: the meter must show non-zero utilization as non-zero — a whole-percent round of
// 2330/1e6 is 0, which read as "0%" on a 1M-context model after real turns.
describe("contextLabel", () => {
  it("shows 0% only for an empty or unknown-token context", () => {
    expect(contextLabel({ used: 0, window: 1_000_000 })).toBe("0%");
    expect(contextLabel({ used: 0, window: 200_000 })).toBe("0%");
    expect(contextLabel(null)).toBe(null);
    expect(contextLabel(undefined)).toBe(null);
    expect(contextLabel({ used: 5000, window: 0 })).toBe(null);
  });

  it("never shows 0% for a non-zero context on a large window", () => {
    expect(contextLabel({ used: 2330, window: 1_000_000 })).toBe("<1%");
    expect(contextLabel({ used: 9999, window: 1_000_000 })).toBe("<1%");
    expect(contextLabel({ used: 1000, window: 1_000_000 })).toBe("<1%");
  });

  it("shows one decimal below 10% and whole percent from 10", () => {
    expect(contextLabel({ used: 10_000, window: 1_000_000 })).toBe("1.0%");
    expect(contextLabel({ used: 50_000, window: 1_000_000 })).toBe("5.0%");
    expect(contextLabel({ used: 60_000, window: 1_000_000 })).toBe("6.0%");
    expect(contextLabel({ used: 4096, window: 40_960 })).toBe("10%");
    expect(contextLabel({ used: 128_400, window: 200_000 })).toBe("64%");
    expect(contextLabel({ used: 990_000, window: 1_000_000 })).toBe("99%");
  });

  it("shows no decimal on whole-percent values", () => {
    expect(contextLabel({ used: 1000, window: 10000 })).toBe("10%");
  });
});

describe("ContextMeter", () => {
  it("does not render without a context or with a non-positive window", () => {
    expect(ContextMeter({ context: null, className: undefined })).toBe(null);
    expect(ContextMeter({ context: { used: 999, window: 0 }, className: undefined })).toBe(null);
    expect(ContextMeter({ context: { used: 999, window: -5 }, className: undefined })).toBe(null);
  });

  it("renders the precise label for sub-10% utilization", () => {
    const meter = ContextMeter({ context: { used: 2330, window: 1_000_000 }, className: undefined })!;
    expect(meter.type).toBe("span");
    expect(JSON.stringify(meter.props)).not.toContain("0% used");
    expect(JSON.stringify(meter.props)).toContain("<1% used");
  });

  it("renders a hairline fill for any non-zero context", () => {
    const meter = ContextMeter({ context: { used: 2330, window: 1_000_000 }, className: undefined })!;
    expect(JSON.stringify(meter.props)).toContain("2%");
    const empty = ContextMeter({ context: { used: 0, window: 200_000 }, className: undefined })!;
    expect(JSON.stringify(empty.props)).toContain("0%");
  });
});
