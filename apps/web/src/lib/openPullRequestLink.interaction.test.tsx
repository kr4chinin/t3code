// @vitest-environment jsdom
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS, type ClientSettings } from "@t3tools/contracts/settings";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  openInBrowser: false,
  hasProject: true,
  openPanel: vi.fn(),
  openExternal: vi.fn(async () => undefined),
  openOrdinaryLink: vi.fn(async () => undefined),
  navigate: vi.fn(),
  toast: vi.fn(),
}));

const environmentId = EnvironmentId.make("environment-1");
const threadRef = { environmentId, threadId: ThreadId.make("thread-1") };
const url = "https://github.com/acme/repo/pull/42";
const projects = [
  {
    id: ProjectId.make("project-1"),
    environmentId,
    repositoryIdentity: {
      provider: "github",
      canonicalKey: "github.com/acme/repo",
      owner: "acme",
      name: "repo",
      locator: {
        source: "git-remote",
        remoteName: "origin",
        remoteUrl: "https://github.com/acme/repo.git",
      },
    },
  },
];
const serverConfigs = new Map([
  [
    environmentId,
    {
      environment: { capabilities: { pullRequests: true, threadPullRequests: true } },
    },
  ],
]);

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => state.navigate }));
vi.mock("../state/entities", () => ({
  useProjects: () => (state.hasProject ? projects : []),
  useServerConfigs: () => serverConfigs,
}));
vi.mock("../state/environments", () => ({ usePrimaryEnvironmentId: () => environmentId }));
vi.mock("../state/server", () => ({ serverEnvironment: {} }));
vi.mock("../rightPanelStore", () => ({
  useRightPanelStore: { getState: () => ({ openPullRequest: state.openPanel }) },
}));
vi.mock("../hooks/useSettings", () => ({
  useClientSettings: (select: (settings: ClientSettings) => unknown) =>
    select({
      ...DEFAULT_CLIENT_SETTINGS,
      browserLinkTarget: "app",
      openPullRequestLinksInBrowser: state.openInBrowser,
    }),
}));
vi.mock("~/localApi", () => ({
  readLocalApi: () => ({ shell: { openExternal: state.openExternal } }),
}));
vi.mock("../browser/useOpenLink", () => ({ useOpenLink: () => state.openOrdinaryLink }));
vi.mock("../components/ui/toast", () => ({
  stackedThreadToast: (value: unknown) => value,
  toastManager: { add: state.toast },
}));

import { useOpenChangeRequestLink, useOpenPrLink } from "./openPullRequestLink";

function Links() {
  const openChatLink = useOpenChangeRequestLink(threadRef);
  const openPr = useOpenPrLink(threadRef);
  return (
    <>
      <a href={url} onClick={(event) => openChatLink(event, url)}>
        Chat PR
      </a>
      <a href={url} onClick={(event) => openPr(event, url)}>
        PR badge
      </a>
      <button onClick={(event) => openPr(event, url)}>View PR</button>
      <a href="https://example.com" onClick={(event) => openChatLink(event, "https://example.com")}>
        Ordinary link
      </a>
    </>
  );
}

let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  vi.clearAllMocks();
  state.openInBrowser = false;
  state.hasProject = true;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Links />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function click(text: string, modifiers: MouseEventInit = {}) {
  const element = [...container.querySelectorAll("a, button")].find(
    (element) => element.textContent === text,
  )!;
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, ...modifiers });
  let intercepted = false;
  // Avoid jsdom's navigation while retaining whether the application consumed the click.
  const cancelNavigation = (clickEvent: Event) => {
    intercepted = clickEvent.defaultPrevented;
    clickEvent.preventDefault();
  };
  container.addEventListener("click", cancelNavigation, { once: true });
  await act(async () => {
    element.dispatchEvent(event);
  });
  container.removeEventListener("click", cancelNavigation);
  return intercepted;
}

describe("pull request link destinations", () => {
  it.each(["Chat PR", "PR badge", "View PR"])("keeps %s in the panel by default", async (label) => {
    await click(label);
    expect(state.openPanel).toHaveBeenCalledWith(
      threadRef,
      expect.objectContaining({ number: 42, url }),
    );
    expect(state.openExternal).not.toHaveBeenCalled();
  });

  it.each(["Chat PR", "PR badge"])(
    "opens %s in the system browser even when ordinary links use the in-app browser",
    async (label) => {
      state.openInBrowser = true;
      await act(async () => root.render(<Links />));
      await click(label);
      expect(state.openExternal).toHaveBeenCalledExactlyOnceWith(url);
      expect(state.openPanel).not.toHaveBeenCalled();
      expect(state.openOrdinaryLink).not.toHaveBeenCalled();
    },
  );

  it("opens View PR buttons externally without an anchor or a matching project", async () => {
    state.openInBrowser = true;
    state.hasProject = false;
    await act(async () => root.render(<Links />));
    await click("View PR");
    expect(state.openExternal).toHaveBeenCalledExactlyOnceWith(url);
    expect(state.openPanel).not.toHaveBeenCalled();
    expect(state.openOrdinaryLink).not.toHaveBeenCalled();
  });

  it.each([{ metaKey: true }, { ctrlKey: true }])(
    "leaves modified PR anchors to native navigation: %j",
    async (modifiers) => {
      expect(await click("PR badge", modifiers)).toBe(false);
      expect(state.openPanel).not.toHaveBeenCalled();
      expect(state.openExternal).not.toHaveBeenCalled();
    },
  );

  it("restores panel navigation when the preference is switched off", async () => {
    state.openInBrowser = true;
    await act(async () => root.render(<Links />));
    await click("Chat PR");
    state.openInBrowser = false;
    await act(async () => root.render(<Links />));
    await click("Chat PR");
    expect(state.openExternal).toHaveBeenCalledTimes(1);
    expect(state.openPanel).toHaveBeenCalledTimes(1);
  });

  it("leaves ordinary chat links alone with the preference enabled", async () => {
    state.openInBrowser = true;
    await act(async () => root.render(<Links />));
    expect(await click("Ordinary link")).toBe(false);
    expect(state.openPanel).not.toHaveBeenCalled();
    expect(state.openExternal).not.toHaveBeenCalled();
  });
});
