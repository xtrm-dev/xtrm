import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixtureAdapters, type GithubAuthStatus, type GithubCapabilities } from "../adapters/index.tsx";
import { createFixtureGithubAuth, liveGithubAuth } from "../adapters/github/auth.ts";
import { createFixtureSubstrate } from "../adapters/substrate/fixture.ts";
import { createAppRouter } from "../app/router.tsx";
import { TOOLBAR_CONTROL, TOOLBAR_GHOST } from "../ui/primitives.tsx";

declare module "*?raw" {
  const src: string;
  export default src;
}
// @ts-expect-error -- raw source import for the no-token-literals assertion
import authAdapterSource from "../adapters/github/auth.ts?raw";
// @ts-expect-error -- raw source import for the no-token-literals assertion
import authUiSource from "./auth.tsx?raw";

const TOKEN_LIKE = /(ghu|ghr|gho)_[A-Za-z0-9]+/;

// XTRM-990: the shared control is a class pair, not a look. `ToolbarButton` renders
// `TOOLBAR_CONTROL` then `TOOLBAR_GHOST` before any caller class, so matching that prefix proves
// the control was built from it. `h-7` alone proves nothing: the deleted local `actionButton`
// began `flex h-7` too, and a hand-written bordered copy would keep it.
const TOOLBAR_PAIR = `${TOOLBAR_CONTROL} ${TOOLBAR_GHOST}`;

function expectToolbarControl(control: Element) {
  const className = control.getAttribute("class") ?? "";
  expect(className.startsWith(TOOLBAR_PAIR)).toBe(true);
  expect(className).not.toContain("border-border-muted");
}

function renderAt(url: string, status?: GithubAuthStatus, capabilities?: Record<string, GithubCapabilities>) {
  return renderAtAuth(url, createFixtureGithubAuth({ status, capabilities }));
}

function renderAtAuth(url: string, githubAuth: ReturnType<typeof createFixtureGithubAuth>) {
  const history = createMemoryHistory({ initialEntries: [url] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const substrate = createFixtureSubstrate();
  const router = createAppRouter({ adapters: { ...fixtureAdapters, githubAuth, substrate }, history, queryClient });
  render(<RouterProvider router={router} />);
  return { router, githubAuth };
}

const PENDING: GithubAuthStatus = {
  state: "pending",
  auth_source: "none",
  device: {
    user_code: "WDJC-8F39",
    verification_uri: "https://github.com/login/device",
    expires_at: new Date(Date.now() + 14 * 60_000).toISOString(),
    interval: 5,
  },
};

const topBar = () => screen.findByTestId("top-bar");
const notices = () => screen.queryAllByTestId("github-notice");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("top-bar account control", () => {
  it("shows Sign in with GitHub when signed out and opens the device drawer", async () => {
    const { router } = renderAt("/rep/xtrm-dev/xtrm/code/pulls", { state: "signed_out", auth_source: "shared" });
    fireEvent.click(await within(await topBar()).findByRole("button", { name: "Sign in with GitHub" }));
    const el = await screen.findByTestId("inspector-drawer");
    expect(within(el).getByRole("heading", { name: "Sign in with GitHub" })).toBeTruthy();
    // XTRM-996: the start view's own control is pinned, not just the notice's.
    expectToolbarControl(within(el).getByRole("button", { name: "Sign in with GitHub" }));
    expect(router.state.location.search).toMatchObject({ inspect: "github-auth:signin" });
  });

  it("shows Sign in with GitHub when never configured", async () => {
    renderAt("/rep/xtrm-dev/xtrm/code/pulls", { state: "not_configured", auth_source: "none" });
    expect(await within(await topBar()).findByRole("button", { name: "Sign in with GitHub" })).toBeTruthy();
  });

  it("shows an avatar menu with Settings and Sign out when signed in", async () => {
    const { router } = renderAtAuth("/rep/xtrm-dev/xtrm/code/pulls", createFixtureGithubAuth());
    const avatar = await within(await topBar()).findByRole("button", { name: /Jaggerxtrm — GitHub account/ });
    fireEvent.click(avatar);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Settings" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/settings/connections"));
  });

  it("signs out from the avatar menu", async () => {
    renderAtAuth("/rep/xtrm-dev/xtrm/code/pulls", createFixtureGithubAuth());
    fireEvent.click(await within(await topBar()).findByRole("button", { name: /Jaggerxtrm — GitHub account/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Sign out" }));
    expect(await within(await topBar()).findByRole("button", { name: "Sign in with GitHub" })).toBeTruthy();
  });

  it("shows a code entry point while a device flow is pending", async () => {
    renderAt("/rep/xtrm-dev/xtrm/code/pulls", PENDING);
    fireEvent.click(await within(await topBar()).findByRole("button", { name: "Enter GitHub code" }));
    expect(await screen.findByText("WDJC-8F39")).toBeTruthy();
  });
});

describe("Settings > GitHub", () => {
  it("shows connection state, identity, auth source, and token store when signed in", async () => {
    renderAtAuth("/settings/connections", createFixtureGithubAuth());
    expect(await screen.findByText("GitHub — signed in")).toBeTruthy();
    expect(screen.getByText("Jaggerxtrm")).toBeTruthy();
    const rows = screen.getByLabelText("Identity");
    expect(within(rows).getByText("user")).toBeTruthy();
    expect(within(rows).getByText("keychain")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it("lists installations with Install and Configure links", async () => {
    renderAtAuth("/settings/connections", createFixtureGithubAuth());
    const section = await screen.findByLabelText("Installations");
    expect(await within(section).findByText("xtrm-dev")).toBeTruthy();
    const install = within(section).getAllByRole("link", { name: /Install/ })[0]!;
    expect(install.getAttribute("href")).toContain("github.com/apps/xtrm-console/installations/new");
    const configure = within(section).getByRole("link", { name: "Configure" });
    expect(configure.getAttribute("href")).toContain("github.com/organizations/xtrm-dev");
    expect(within(section).getByText(/pull_requests read/)).toBeTruthy();
  });

  it("explains the signed-out shared-token state and offers sign-in", async () => {
    renderAt("/settings/connections", { state: "signed_out", auth_source: "shared" });
    const page = await screen.findByRole("region", { name: "Settings" });
    // The page renders before the account block has loaded its status.
    expect(await within(page).findByText("GitHub — signed out")).toBeTruthy();
    expect(within(page).getByText(/read-only/)).toBeTruthy();
    expect(within(page).getByRole("button", { name: "Sign in with GitHub" })).toBeTruthy();
  });

  it("explains the not-configured state", async () => {
    renderAt("/settings/connections", { state: "not_configured", auth_source: "none" });
    expect(await screen.findByText(/no GitHub App configured/)).toBeTruthy();
  });
});

describe("device-code drawer", () => {
  it("renders the code large with copy, device link, countdown, cancel, and moves focus to the code", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderAt("/rep/xtrm-dev/xtrm/code/pulls?inspect=github-auth:signin", PENDING);
    const el = await screen.findByTestId("inspector-drawer");
    expect(await within(el).findByText("WDJC-8F39")).toBeTruthy();
    const link = within(el).getByRole("link", { name: /Open github.com\/login\/device/ });
    expect(link.getAttribute("href")).toBe("https://github.com/login/device");
    expect(within(el).getByText(/Code expires in/)).toBeTruthy();
    // Accessibility: focus lands on the device code; the countdown is plain text.
    await waitFor(() => expect(document.activeElement?.textContent).toContain("WDJC-8F39"));

    fireEvent.click(within(el).getByRole("button", { name: "Copy device code" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("WDJC-8F39"));
    expect(await within(el).findByText("Code copied.")).toBeTruthy();
  });

  it("cancels back to signed out", async () => {
    renderAt("/rep/xtrm-dev/xtrm/code/pulls?inspect=github-auth:signin", PENDING);
    const el = await screen.findByTestId("inspector-drawer");
    fireEvent.click(await within(el).findByRole("button", { name: "Cancel" }));
    expect(await within(el).findByRole("heading", { name: "Sign in with GitHub" })).toBeTruthy();
  });

  it("transitions pending -> signed_in when the backend poll completes", async () => {
    const { githubAuth } = renderAt("/rep/xtrm-dev/xtrm/code/pulls", PENDING);
    fireEvent.click(await within(await topBar()).findByRole("button", { name: "Enter GitHub code" }));
    const el = await screen.findByTestId("inspector-drawer");
    expect(await within(el).findByText("WDJC-8F39")).toBeTruthy();
    expectToolbarControl(within(el).getByRole("button", { name: "Check now" }));
    githubAuth.__resolve("signed_in");
    fireEvent.click(within(el).getByRole("button", { name: "Check now" }));
    expect(await within(el).findByText("Signed in as Jaggerxtrm")).toBeTruthy();
    expectToolbarControl(within(el).getByRole("button", { name: "Close" }));
    // The top bar follows the same status read.
    expect(await within(await topBar()).findByRole("button", { name: /Jaggerxtrm — GitHub account/ })).toBeTruthy();
  });

  it("shows error states with retry", async () => {
    renderAt("/rep/xtrm-dev/xtrm/code/pulls?inspect=github-auth:signin", {
      state: "error",
      auth_source: "none",
      error: { code: "expired_token", message: "The device code expired." },
    });
    const el = await screen.findByTestId("inspector-drawer");
    expect(await within(el).findByText(/The device code expired/)).toBeTruthy();
    expectToolbarControl(within(el).getByRole("button", { name: "Try again" }));
    expectToolbarControl(within(el).getByRole("button", { name: "Check status" }));
    fireEvent.click(within(el).getByRole("button", { name: "Try again" }));
    expect(await within(el).findByText("WDJC-8F39")).toBeTruthy();
  });
});

describe("inline GitHub notices", () => {
  const pulls = "/rep/xtrm-dev/xtrm/code/pulls";

  it("calls out setup with a Settings control when not configured", async () => {
    renderAt(pulls, { state: "not_configured", auth_source: "none" });
    const [notice] = await screen.findAllByTestId("github-notice");
    expect(notice!.dataset.state).toBe("not_configured");
    expect(within(notice!).getByText(/GitHub is not configured/)).toBeTruthy();
    // XTRM-990: this was an accent-coloured underline link; it is the shared ghost control now.
    expectToolbarControl(within(notice!).getByRole("button", { name: "Open Settings" }));
    fireEvent.click(within(notice!).getByRole("button", { name: "Open Settings" }));
    expect(await screen.findByText("GitHub — not configured")).toBeTruthy();
  });

  it("reports read-only shared-token mode when signed out", async () => {
    renderAt(pulls, { state: "signed_out", auth_source: "shared" });
    expect(await screen.findByText("Read-only via shared token.")).toBeTruthy();
  });

  it("asks for sign-in when signed out with no shared token", async () => {
    renderAt(pulls, { state: "signed_out", auth_source: "none" });
    const notice = (await screen.findByText("Sign in to load GitHub data.")).closest("[data-testid=github-notice]")!;
    // The top bar carries the same label, so the assertion is scoped to the notice it is about.
    expectToolbarControl(within(notice as HTMLElement).getByRole("button", { name: "Sign in with GitHub" }));
  });

  it("asks to sign in again when expired", async () => {
    renderAt(pulls, { state: "expired", auth_source: "none" });
    const notice = await screen.findByText("GitHub sign-in expired.");
    const signInAgain = within(notice.closest("[data-testid=github-notice]")!).getByRole("button", { name: "Sign in again" });
    expectToolbarControl(signInAgain);
    fireEvent.click(signInAgain);
    expect(await screen.findByTestId("inspector-drawer")).toBeTruthy();
  });

  it("offers the device code from the pending notice", async () => {
    renderAt(pulls, PENDING);
    const notice = (await screen.findByText("Sign-in in progress.")).closest("[data-testid=github-notice]")!;
    expect(notice.dataset.state).toBe("pending");
    // The top bar's own entry point is `Enter GitHub code`, so the exact name scopes this one.
    const enterCode = within(notice as HTMLElement).getByRole("button", { name: "Enter code" });
    expectToolbarControl(enterCode);
    fireEvent.click(enterCode);
    expect(await screen.findByTestId("inspector-drawer")).toBeTruthy();
  });

  it("offers a retry from the error notice", async () => {
    renderAt(pulls, {
      state: "error",
      auth_source: "none",
      error: { code: "bad_gateway", message: "GitHub login is unavailable" },
    });
    const notice = (await screen.findByText(/GitHub sign-in failed: GitHub login is unavailable/)).closest("[data-testid=github-notice]")!;
    expect(notice.dataset.state).toBe("error");
    const retry = within(notice as HTMLElement).getByRole("button", { name: "Try again" });
    expectToolbarControl(retry);
    fireEvent.click(retry);
    expect(await screen.findByTestId("inspector-drawer")).toBeTruthy();
  });

  it("calls out a missing app installation with an Install link", async () => {
    renderAt(pulls, undefined, {
      "xtrm-dev/xtrm": {
        auth_source: "user",
        installed: false,
        permissions: {},
        can: { read_pulls: false, read_checks: false, read_contents: false, read_issues: false, read_actions: false },
      },
    });
    const notice = await screen.findByText(/is not installed on xtrm-dev\/xtrm/);
    const el = notice.closest("[data-testid=github-notice]")!;
    expect(el.dataset.state).toBe("not-installed");
    const install = within(el).getByRole("link", { name: /Install xtrm-console/ });
    expect(install.getAttribute("href")).toContain("github.com/apps/xtrm-console/installations/new");
    // XTRM-990: notice controls are the shared toolbar control, not a private bordered button. The
    // install link is an anchor, so it takes the control classes rather than ToolbarButton itself.
    expectToolbarControl(install);
    expectToolbarControl(within(el).getByRole("button", { name: "Open Settings" }));
  });

  it("stays silent when signed in with the app installed", async () => {
    renderAtAuth(pulls, createFixtureGithubAuth());
    await screen.findByText("feat(XTRM-301): rail keyboard model v2");
    expect(notices()).toHaveLength(0);
  });
});

describe("one control language in the auth surfaces", () => {
  // The local bordered button XTRM-937 removed from Settings was still here (XTRM-990); the source is
  // the only place a reintroduced copy would hide, since both styles render as a button in the DOM.
  it("keeps no private action button in this file", () => {
    expect(authUiSource as string).not.toContain("const actionButton");
  });

  it("renders the device panel controls through ToolbarButton", async () => {
    renderAt("/rep/xtrm-dev/xtrm/code/pulls?inspect=github-auth:signin", PENDING);
    const el = await screen.findByTestId("inspector-drawer");
    // The drawer settles only once the pending status arrives; before that it renders a skeleton.
    expect(await within(el).findByText("WDJC-8F39")).toBeTruthy();
    for (const name of ["Copy device code", "Check now", "Cancel"]) {
      expectToolbarControl(within(el).getByRole("button", { name }));
    }
  });
});

describe("live adapter degradation", () => {
  it("degrades to not_configured on 404 (pre-XTRM-404 backend)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 404, ok: false }));
    expect(await liveGithubAuth.status()).toEqual({ state: "not_configured", auth_source: "none" });
    expect((await liveGithubAuth.installations()).install_url).toContain("github.com/apps/xtrm-console");
    expect((await liveGithubAuth.capabilities("xtrm-dev/xtrm")).installed).toBe(true);
  });
});

describe("device start error surfacing", () => {
  const PENDING_STATUS = {
    state: "pending",
    auth_source: "none",
    device: { user_code: "WDJC-8F39", verification_uri: "https://github.com/login/device", expires_at: new Date(Date.now() + 900_000).toISOString(), interval: 5 },
  };
  const res = (status: number, body: unknown) => ({ status, ok: status >= 200 && status < 300, json: async () => body }) as Response;

  it("returns the 202 status object on success", async () => {
    const fetch = vi.fn().mockResolvedValue(res(202, PENDING_STATUS));
    vi.stubGlobal("fetch", fetch);
    const status = await liveGithubAuth.startDevice();
    expect(status.state).toBe("pending");
    expect(status.device?.user_code).toBe("WDJC-8F39");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("returns not_configured on a 400 not_configured failure", async () => {
    const fetch = vi.fn().mockResolvedValue(res(400, { error: "not_configured", message: "GitHub App is not configured" }));
    vi.stubGlobal("fetch", fetch);
    expect(await liveGithubAuth.startDevice()).toEqual({ state: "not_configured", auth_source: "none" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("merges a 502 failure onto the fresh status as an error state", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(res(502, { error: "bad_gateway", message: "GitHub login is unavailable" }))
      .mockResolvedValueOnce(res(200, { state: "signed_out", auth_source: "shared" }));
    vi.stubGlobal("fetch", fetch);
    const status = await liveGithubAuth.startDevice();
    expect(status.state).toBe("error");
    expect(status.auth_source).toBe("shared");
    expect(status.error).toEqual({ code: "bad_gateway", message: "GitHub login is unavailable" });
  });

  it("falls back to an http_* code when the failure body is not JSON", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ status: 502, ok: false, json: async () => { throw new Error("no json"); } } as Response)
      .mockResolvedValueOnce(res(200, { state: "signed_out", auth_source: "none" }));
    vi.stubGlobal("fetch", fetch);
    const status = await liveGithubAuth.startDevice();
    expect(status.state).toBe("error");
    expect(status.error?.code).toBe("http_502");
  });

  it("renders the start error in Settings with a working Try again", async () => {
    renderAt("/settings/connections", {
      state: "error",
      auth_source: "none",
      error: { code: "bad_gateway", message: "GitHub login is unavailable" },
    });
    const page = await screen.findByRole("region", { name: "Settings" });
    expect(await within(page).findByText(/GitHub login is unavailable/)).toBeTruthy();
    fireEvent.click(within(page).getByRole("button", { name: "Try again" }));
    expect(await within(page).findByText(/is waiting at github.com\/login\/device/)).toBeTruthy();
  });
});

describe("no token handling in the browser", () => {
  it("keeps token-like strings out of storage and fixture sources after the fixture flow", async () => {
    const { githubAuth } = renderAt("/rep/xtrm-dev/xtrm/code/pulls", { state: "signed_out", auth_source: "none" });
    fireEvent.click(await within(await topBar()).findByRole("button", { name: "Sign in with GitHub" }));
    const el = await screen.findByTestId("inspector-drawer");
    fireEvent.click(await within(el).findByRole("button", { name: "Sign in with GitHub" }));
    expect(await screen.findByText("WDJC-8F39")).toBeTruthy();
    githubAuth.__resolve("signed_in");
    fireEvent.click(await within(el).findByRole("button", { name: "Check now" }));
    expect(await within(el).findByText("Signed in as Jaggerxtrm")).toBeTruthy();

    const haystacks: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      haystacks.push(`${k}=${localStorage.getItem(k)}`);
    }
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i)!;
      haystacks.push(`${k}=${sessionStorage.getItem(k)}`);
    }
    haystacks.push(authAdapterSource as string, authUiSource as string);
    for (const hay of haystacks) expect(hay).not.toMatch(TOKEN_LIKE);
  });
});
