import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fixtureAdapters, type StreamState } from "../adapters/index.tsx";
import { createFixtureAgent } from "../adapters/agent/fixture.ts";
import { createAppRouter } from "../app/router.tsx";

// While the live stream is down the session state is unknown: the composer sends, steers and stops
// nothing, says why, and re-enables on reconnect (XTRM-615).
function renderWorkingSession() {
  let stream: StreamState = "disconnected";
  const listeners = new Set<() => void>();
  const base = createFixtureAgent({ delayMs: 0 });
  const submit = vi.fn(base.submit);
  const agent = {
    ...base,
    submit,
    streamState: () => stream,
    subscribeStream: (l: () => void) => (listeners.add(l), () => void listeners.delete(l)),
  };
  const history = createMemoryHistory({ initialEntries: ["/agent/pi-main"] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<RouterProvider router={createAppRouter({ adapters: { ...fixtureAdapters, agent }, history, queryClient })} />);
  const setStream = (next: StreamState) =>
    act(() => {
      stream = next;
      listeners.forEach((l) => l());
    });
  return { submit, setStream };
}

describe("Composer while the live stream is disconnected", () => {
  it("disables send, steer, follow-up and stop with a visible reason, and re-enables on reconnect", async () => {
    const { submit, setStream } = renderWorkingSession();
    const box = await screen.findByRole("textbox", { name: "Message pi-main" }, { timeout: 10_000 });
    fireEvent.change(box, { target: { value: "keep going" } });

    const controls = (): HTMLButtonElement[] => [
      screen.getByRole("button", { name: "Stop" }),
      screen.getByRole("radio", { name: "Steer" }),
      screen.getByRole("radio", { name: "Follow-up" }),
      screen.getByRole("button", { name: /^Steer/ }),
    ] as HTMLButtonElement[];
    expect(controls().map((c) => c.disabled)).toEqual([true, true, true, true]);
    expect(screen.getByTestId("composer-disconnected").textContent).toContain("Disconnected from the agent host");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(submit).not.toHaveBeenCalled();
    expect((box as HTMLTextAreaElement).value).toBe("keep going");

    setStream("connected");
    expect(controls().map((c) => c.disabled)).toEqual([false, false, false, false]);
    expect(screen.queryByTestId("composer-disconnected")).toBeNull();
  }, 20_000);
});
