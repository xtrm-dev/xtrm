import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

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
