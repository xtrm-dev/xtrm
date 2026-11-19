import { afterEach } from "vitest";
import { cleanup, configure } from "@testing-library/react";

// XTRM-914: every `findBy*`/`waitFor` waited 1 s by default while a rendered route under CPU
// contention takes longer than that, so a loaded runner failed with "Unable to find role ..."
// at random. Give the async queries a budget under the 20 s per-test timeout in vite.config.ts
// (XTRM-914): 10 s is longer than the slowest measured test (4914 ms) yet still short of the
// test budget, so a genuinely missing element reports its role instead of a bare test timeout.
configure({ asyncUtilTimeout: 10_000 });

// jsdom lacks the layout observers used by motion-panels and the virtualizer.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof window !== "undefined") {
  globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  Element.prototype.scrollIntoView ??= function () {};
  // The virtualizer measures its scroll element; jsdom has no layout.
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 720 });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 960 });
  window.scrollTo = () => {};

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });
}
