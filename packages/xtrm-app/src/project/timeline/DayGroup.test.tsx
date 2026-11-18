import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ScheduleEvent } from "../../adapters/status-board/types.ts";
import { statusTone } from "./EventRow.tsx";
import { NowMarker } from "./NowMarker.tsx";
import { dayKey, formatDayHeading, formatTime, groupByDay, isPastEvent, parseDay, shiftDay, sortEvents } from "./DayGroup.tsx";

const event = (id: string, day: string, at?: string, end?: string): ScheduleEvent => (at ? { id, day, at, ...(end ? { end } : {}) } : { id, day });

describe("Timeline day arithmetic", () => {
  it("keys the day in the binding's zone, not the host's", () => {
    const lateEvening = Date.parse("2026-11-18T23:30:00Z");
    expect(dayKey(lateEvening, "UTC")).toBe("2026-11-18");
    expect(dayKey(lateEvening, "Europe/Berlin")).toBe("2026-11-19");
    expect(dayKey(lateEvening, "America/Los_Angeles")).toBe("2026-11-18");
  });

  it("steps one calendar day across month and leap boundaries", () => {
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDay("2024-03-01", -1)).toBe("2024-02-29");
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("accepts only a real YYYY-MM-DD day", () => {
    expect(parseDay("2026-11-18")).toBe("2026-11-18");
    expect(parseDay("2026-13-40")).toBeUndefined();
    expect(parseDay("today")).toBeUndefined();
    expect(parseDay(20261118)).toBeUndefined();
    expect(parseDay(undefined)).toBeUndefined();
  });

  it("labels the day itself and its neighbours", () => {
    expect(formatDayHeading("2026-11-18", "2026-11-18")).toContain("today");
    expect(formatDayHeading("2026-11-17", "2026-11-18")).toContain("yesterday");
    expect(formatDayHeading("2026-11-19", "2026-11-18")).toContain("tomorrow");
    expect(formatDayHeading("2026-11-21", "2026-11-18")).not.toContain("today");
    expect(formatDayHeading("2026-11-18", "2026-11-18")).toContain("18 Nov 2026");
  });

  it("formats a time in the binding's zone and keeps garbage visibly absent", () => {
    expect(formatTime("2026-11-18T09:05:00Z", "UTC")).toBe("09:05");
    expect(formatTime("2026-11-18T09:05:00Z", "Europe/Berlin")).toBe("10:05");
    expect(formatTime("not-a-time", "UTC")).toBe("--:--");
  });
});

describe("Timeline ordering", () => {
  it("orders events by start and keeps an unreadable start last", () => {
    const ordered = sortEvents([event("c", "2026-11-18", "2026-11-18T12:00:00Z"), event("a", "2026-11-18", "2026-11-18T08:00:00Z"), event("no-time", "2026-11-18"), event("b", "2026-11-18", "2026-11-18T10:00:00Z")]);
    expect(ordered.map((e) => e.id)).toEqual(["a", "b", "c", "no-time"]);
  });

  it("groups one page by its schedule/<day> record and sorts each day", () => {
    const groups = groupByDay([event("late", "2026-11-19", "2026-11-19T18:00:00Z"), event("early", "2026-11-18", "2026-11-18T07:00:00Z"), event("mid", "2026-11-18", "2026-11-18T09:00:00Z"), event("bad-day", "not-a-day", "2026-11-18T09:00:00Z")]);
    expect([...groups.keys()]).toEqual(["2026-11-18", "2026-11-19"]);
    expect(groups.get("2026-11-18")?.map((e) => e.id)).toEqual(["early", "mid"]);
  });

  it("calls an event past once its end, or its start without an end, is behind now", () => {
    const now = Date.parse("2026-11-18T12:00:00Z");
    expect(isPastEvent(event("done", "2026-11-18", "2026-11-18T10:00:00Z", "2026-11-18T11:00:00Z"), now)).toBe(true);
    expect(isPastEvent(event("running", "2026-11-18", "2026-11-18T10:00:00Z", "2026-11-18T13:00:00Z"), now)).toBe(false);
    expect(isPastEvent(event("started", "2026-11-18", "2026-11-18T10:00:00Z"), now)).toBe(true);
    expect(isPastEvent(event("later", "2026-11-18", "2026-11-18T13:00:00Z"), now)).toBe(false);
    expect(isPastEvent(event("no-time", "2026-11-18"), now)).toBe(false);
  });

  it("maps a status word to the row's one coloured element", () => {
    expect(statusTone("done")).toBe("success");
    expect(statusTone("failed")).toBe("danger");
    expect(statusTone("planned")).toBe("neutral");
    expect(statusTone("whatever")).toBe("neutral");
  });
});

describe("NowMarker", () => {
  it("renders a separator that names itself with the word", () => {
    render(<NowMarker />);
    const marker = screen.getByRole("separator", { name: "now" });
    expect(marker.textContent).toBe("now");
    expect(marker.querySelector(".border-danger")?.className).toContain("border-t");
  });
});
