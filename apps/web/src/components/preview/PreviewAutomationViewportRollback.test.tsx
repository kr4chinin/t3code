import {
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  ThreadId,
  type PreviewAutomationResponse,
  type PreviewAutomationStreamEvent,
  type PreviewResizeInput,
  type PreviewResizeResult,
  type PreviewViewportSetting,
} from "@t3tools/contracts";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  commitBrowserViewportChange,
  runBrowserViewportMutation,
  subscribeBrowserViewportChange,
} from "~/browser/browserViewportActions";
import { browserViewportSettingKey } from "~/browser/browserViewportLayout";
import { previewRuntimeTabId } from "~/browser/previewRuntimeTabId";
import { __resetClientSettingsPersistenceForTests } from "~/hooks/useSettings";
import {
  applyPreviewDesktopState,
  readThreadPreviewState,
  reconcilePreviewServerSessions,
  resetPreviewStateForTests,
  updatePreviewServerSnapshot,
} from "~/previewStateStore";
import { appAtomRegistry, AppAtomRegistryProvider } from "~/rpc/atomRegistry";

import { PreviewAutomationHosts } from "./PreviewAutomationHosts";

const mocks = vi.hoisted(() => ({
  resize:
    vi.fn<
      (target: {
        environmentId: EnvironmentId;
        input: PreviewResizeInput;
      }) => Promise<AtomCommandResult<PreviewResizeResult, Error>>
    >(),
  respond: vi.fn<(target: { input: PreviewAutomationResponse }) => Promise<void>>(),
  setViewport: vi.fn<() => Promise<void>>(async () => undefined),
  automationSetViewport: vi.fn<() => Promise<void>>(async () => undefined),
  executeJavaScript: vi.fn(async () => ({ width: 390, height: 844 })),
  status: vi.fn(async () => ({ available: true, loading: false })),
  focus: vi.fn(async () => AsyncResult.success(undefined)),
}));

vi.mock("~/localApi", () => ({
  ensureLocalApi: () => ({
    persistence: {
      getClientSettings: async () => DEFAULT_CLIENT_SETTINGS,
    },
  }),
}));
vi.mock("~/env", () => ({ isElectron: true }));
vi.mock("~/state/environments", () => ({
  useEnvironments: () => ({ environments: [{ environmentId }] }),
}));
vi.mock("~/state/preview", () => ({
  previewEnvironment: {
    automationRequests: () => requestsAtom,
    list: vi.fn(),
    open: vi.fn(),
    resize: mocks.resize,
    respondToAutomation: mocks.respond,
    focusAutomationHost: mocks.focus,
  },
}));
vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand: (command: unknown) => command,
}));
vi.mock("~/state/use-atom-query-runner", () => ({ useAtomQueryRunner: vi.fn() }));
vi.mock("./previewBridge", () => ({
  previewBridge: {
    setViewport: mocks.setViewport,
    automation: { setViewport: mocks.automationSetViewport, status: mocks.status },
  },
}));

const environmentId = EnvironmentId.make("rollback-environment");
const threadId = ThreadId.make("rollback-thread");
const threadRef = { environmentId, threadId };
const tabId = "rollback-tab";
const serverEpoch = "rollback-server";
const runtimeTabId = previewRuntimeTabId(threadRef, serverEpoch, tabId);
const previous = { _tag: "freeform", width: 1280, height: 800 } as const;
const requested = { _tag: "freeform", width: 390, height: 844 } as const;
const newer = { _tag: "freeform", width: 844, height: 390 } as const;
let requestsAtom = Atom.make<AsyncResult.AsyncResult<PreviewAutomationStreamEvent, Error>>(
  AsyncResult.initial(false),
);

function deferred<A>() {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

let renderer: ReactTestRenderer | null = null;
let persisted: PreviewViewportSetting;
let revision: number;

function snapshot(viewport: PreviewViewportSetting): PreviewResizeResult {
  revision += 1;
  return {
    threadId,
    tabId,
    navStatus: { _tag: "Idle" },
    canGoBack: false,
    canGoForward: false,
    viewport,
    updatedAt: `2026-10-02T00:00:${String(revision).padStart(2, "0")}.000Z`,
  };
}

function sendResize(requestId = "failed-resize", timeoutMs = 1000) {
  appAtomRegistry.set(
    requestsAtom,
    AsyncResult.success({
      type: "request",
      connectionId: "rollback-connection",
      request: {
        requestId,
        threadId,
        tabId,
        operation: "resize",
        input: { mode: "freeform", width: requested.width, height: requested.height },
        timeoutMs,
      },
    }),
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.resize.mockReset().mockImplementation(async ({ input }) => {
    persisted = input.viewport;
    return AsyncResult.success(snapshot(input.viewport));
  });
  mocks.automationSetViewport.mockReset().mockRejectedValue(new Error("Native resize failed"));
  mocks.setViewport.mockReset().mockResolvedValue(undefined);
  mocks.respond.mockReset();
  mocks.executeJavaScript.mockReset().mockResolvedValue(requested);
  revision = 0;
  persisted = previous;
  __resetClientSettingsPersistenceForTests();
  resetPreviewStateForTests();
  requestsAtom = Atom.make<AsyncResult.AsyncResult<PreviewAutomationStreamEvent, Error>>(
    AsyncResult.initial(false),
  );
  reconcilePreviewServerSessions(threadRef, {
    sessions: [snapshot(previous)],
    serverEpoch,
    revision: 1,
  });
  applyPreviewDesktopState(threadRef, tabId, {
    hasWebContents: true,
    canGoBack: false,
    canGoForward: false,
    loading: false,
    zoomFactor: 1,
    pictureInPicture: false,
    colorScheme: "system",
    audioMuted: false,
    audible: false,
    controller: "none",
    favicon: null,
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setTimeout: (callback: () => void, delay: number) => setTimeout(callback, delay),
  });
  const webview = {
    executeJavaScript: mocks.executeJavaScript,
    getAttribute: (name: string) => {
      if (name === "data-preview-tab") return runtimeTabId;
      if (name === "data-preview-viewport-key") return browserViewportSettingKey(requested);
      if (name === "data-preview-css-width") return String(requested.width);
      if (name === "data-preview-css-height") return String(requested.height);
      return null;
    },
    closest: () => ({ getAttribute: () => "active" }),
  };
  vi.stubGlobal(
    "document",
    Object.assign(new EventTarget(), {
      hasFocus: () => false,
      visibilityState: "visible",
      querySelectorAll: () => [webview],
    }),
  );
  await act(() => {
    renderer = create(
      <AppAtomRegistryProvider>
        <PreviewAutomationHosts />
      </AppAtomRegistryProvider>,
    );
  });
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  resetPreviewStateForTests();
  __resetClientSettingsPersistenceForTests();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("automation viewport failure rollback across server versions", () => {
  it.each(["absent", "version-only", "predecessor-only", "modern"] as const)(
    "restores server, UI and guest after native failure with %s write metadata",
    async (metadata) => {
      mocks.resize.mockImplementation(async ({ input }) => {
        const predecessor = persisted;
        persisted = input.viewport;
        const result = snapshot(input.viewport);
        return AsyncResult.success({
          ...result,
          ...(metadata === "version-only" || metadata === "modern"
            ? { stateVersion: { serverEpoch, revision } }
            : {}),
          ...(metadata === "predecessor-only" || metadata === "modern"
            ? { previousViewport: predecessor }
            : {}),
        });
      });
      const response = deferred<PreviewAutomationResponse>();
      const restored = deferred<void>();
      mocks.setViewport.mockImplementation(async () => restored.resolve());
      mocks.respond.mockImplementation(async ({ input }) => response.resolve(input));

      await act(async () => {
        sendResize();
        await response.promise;
        await restored.promise;
      });

      expect(await response.promise).toMatchObject({ ok: false });
      expect(persisted).toEqual(previous);
      expect(readThreadPreviewState(threadRef).sessions[tabId]?.viewport).toEqual(previous);
      expect(mocks.setViewport).toHaveBeenCalledWith(runtimeTabId, {
        width: previous.width,
        height: previous.height,
      });
      expect(mocks.resize.mock.calls[1]?.[0].input.expectedStateVersion).toEqual(
        metadata === "version-only" || metadata === "modern"
          ? { serverEpoch, revision: 2 }
          : undefined,
      );
    },
  );

  it("restores a legacy server setting after rendered viewport readiness expires", async () => {
    vi.useFakeTimers();
    mocks.automationSetViewport.mockResolvedValue(undefined);
    const readStarted = deferred<void>();
    mocks.executeJavaScript.mockImplementation(async () => {
      readStarted.resolve();
      return previous;
    });
    const response = deferred<PreviewAutomationResponse>();
    const restored = deferred<void>();
    mocks.setViewport.mockImplementation(async () => restored.resolve());
    mocks.respond.mockImplementation(async ({ input }) => response.resolve(input));

    await act(async () => {
      sendResize();
      await readStarted.promise;
      await vi.advanceTimersByTimeAsync(800);
      await response.promise;
      await restored.promise;
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(await response.promise).toMatchObject({ ok: false });
    expect(persisted).toEqual(previous);
    expect(readThreadPreviewState(threadRef).sessions[tabId]?.viewport).toEqual(previous);
    expect(mocks.setViewport).toHaveBeenCalledWith(runtimeTabId, {
      width: previous.width,
      height: previous.height,
    });
  });

  it.each(["legacy", "modern"] as const)(
    "keeps a newer remote viewport after native failure on a %s server",
    async (server) => {
      const nativeStarted = deferred<void>();
      const nativeFailure = deferred<void>();
      mocks.automationSetViewport.mockImplementation(async () => {
        nativeStarted.resolve();
        await nativeFailure.promise;
        throw new Error("Native resize failed");
      });
      const conflict = deferred<void>();
      mocks.resize.mockImplementation(async ({ input }) => {
        if (input.expectedStateVersion) {
          conflict.resolve();
          throw new Error("Viewport revision conflict");
        }
        const predecessor = persisted;
        persisted = input.viewport;
        const result = snapshot(input.viewport);
        return AsyncResult.success({
          ...result,
          ...(server === "modern"
            ? { stateVersion: { serverEpoch, revision }, previousViewport: predecessor }
            : {}),
        });
      });
      const response = deferred<PreviewAutomationResponse>();
      mocks.respond.mockImplementation(async ({ input }) => response.resolve(input));

      await act(async () => {
        sendResize();
        await nativeStarted.promise;
        persisted = newer;
        const remote = snapshot(newer);
        updatePreviewServerSnapshot(threadRef, {
          ...remote,
          ...(server === "modern" ? { stateVersion: { serverEpoch, revision } } : {}),
        });
        nativeFailure.resolve();
        await response.promise;
        if (server === "modern") await conflict.promise;
      });

      expect(persisted).toEqual(newer);
      expect(readThreadPreviewState(threadRef).sessions[tabId]?.viewport).toEqual(newer);
      expect(mocks.resize).toHaveBeenCalledTimes(server === "modern" ? 2 : 1);
      expect(mocks.setViewport).not.toHaveBeenCalled();
      if (server === "modern") {
        expect(mocks.resize.mock.calls[1]?.[0].input.expectedStateVersion).toEqual({
          serverEpoch,
          revision: 2,
        });
      }
    },
  );

  it("captures the predecessor when persistence starts, after an earlier queued resize", async () => {
    const earlierStarted = deferred<void>();
    const releaseEarlier = deferred<void>();
    const earlier = runBrowserViewportMutation(runtimeTabId, async () => {
      earlierStarted.resolve();
      await releaseEarlier.promise;
      const result = await mocks.resize({
        environmentId,
        input: { threadId, tabId, viewport: newer },
      });
      if (result._tag === "Failure") throw new Error("Unexpected resize failure");
      updatePreviewServerSnapshot(threadRef, result.value);
    });
    await earlierStarted.promise;
    const response = deferred<PreviewAutomationResponse>();
    const restored = deferred<void>();
    mocks.setViewport.mockImplementation(async () => restored.resolve());
    mocks.respond.mockImplementation(async ({ input }) => response.resolve(input));

    await act(async () => {
      sendResize();
      releaseEarlier.resolve();
      await earlier;
      await response.promise;
      await restored.promise;
    });

    expect(mocks.resize.mock.calls.map(([target]) => target.input.viewport)).toEqual([
      newer,
      requested,
      newer,
    ]);
    expect(persisted).toEqual(newer);
    expect(readThreadPreviewState(threadRef).sessions[tabId]?.viewport).toEqual(newer);
    expect(mocks.setViewport).toHaveBeenCalledWith(runtimeTabId, {
      width: newer.width,
      height: newer.height,
    });
  });

  it("compensates a late legacy persistence response when no newer mutation supersedes it", async () => {
    vi.useFakeTimers();
    const firstStarted = deferred<void>();
    const firstResponse = deferred<ReturnType<typeof AsyncResult.success<PreviewResizeResult>>>();
    mocks.resize.mockImplementationOnce(async ({ input }) => {
      persisted = input.viewport;
      firstStarted.resolve();
      return firstResponse.promise;
    });
    const response = deferred<PreviewAutomationResponse>();
    const restored = deferred<void>();
    mocks.setViewport.mockImplementation(async () => restored.resolve());
    mocks.respond.mockImplementation(async ({ input }) => response.resolve(input));

    await act(async () => {
      sendResize();
      await firstStarted.promise;
      await vi.advanceTimersByTimeAsync(800);
      await response.promise;
      firstResponse.resolve(AsyncResult.success(snapshot(requested)));
      await firstResponse.promise;
      await restored.promise;
    });

    expect(persisted).toEqual(previous);
    expect(readThreadPreviewState(threadRef).sessions[tabId]?.viewport).toEqual(previous);
    expect(mocks.resize).toHaveBeenCalledTimes(2);
  });

  it("keeps modern CAS rollback after a newer visible resize fails without changing server state", async () => {
    const nativeStarted = deferred<void>();
    const failNative = deferred<void>();
    mocks.automationSetViewport.mockImplementation(async () => {
      nativeStarted.resolve();
      await failNative.promise;
      throw new Error("Native resize failed");
    });
    mocks.resize.mockImplementation(async ({ input }) => {
      if (input.viewport === newer) {
        return AsyncResult.failure(Cause.fail(new Error("Newer resize failed")));
      }
      const predecessor = persisted;
      persisted = input.viewport;
      return AsyncResult.success({
        ...snapshot(input.viewport),
        stateVersion: { serverEpoch, revision },
        previousViewport: predecessor,
      });
    });
    const unsubscribe = subscribeBrowserViewportChange(runtimeTabId, async (viewport) => {
      const result = await mocks.resize({ environmentId, input: { threadId, tabId, viewport } });
      if (result._tag === "Failure") throw new Error("Newer resize failed");
      updatePreviewServerSnapshot(threadRef, result.value);
    });
    const response = deferred<PreviewAutomationResponse>();
    const restored = deferred<void>();
    mocks.setViewport.mockImplementation(async () => restored.resolve());
    mocks.respond.mockImplementation(async ({ input }) => response.resolve(input));

    try {
      await act(async () => {
        sendResize();
        await nativeStarted.promise;
        await expect(commitBrowserViewportChange(runtimeTabId, newer)).rejects.toThrow(
          "Newer resize failed",
        );
        failNative.resolve();
        await response.promise;
      });

      expect(mocks.resize).toHaveBeenCalledTimes(3);
      await restored.promise;
      expect(mocks.resize.mock.calls[2]?.[0].input.expectedStateVersion).toEqual({
        serverEpoch,
        revision: 2,
      });
      expect(persisted).toEqual(previous);
      expect(readThreadPreviewState(threadRef).sessions[tabId]?.viewport).toEqual(previous);
    } finally {
      unsubscribe();
    }
  });

  it("does not merge a legacy response into a replacement server runtime", async () => {
    const firstStarted = deferred<void>();
    const firstResponse = deferred<ReturnType<typeof AsyncResult.success<PreviewResizeResult>>>();
    mocks.resize.mockImplementationOnce(async () => {
      firstStarted.resolve();
      return firstResponse.promise;
    });
    const response = deferred<PreviewAutomationResponse>();
    mocks.respond.mockImplementation(async ({ input }) => response.resolve(input));

    await act(async () => {
      sendResize();
      await firstStarted.promise;
      reconcilePreviewServerSessions(threadRef, {
        sessions: [snapshot(newer)],
        serverEpoch: "replacement-server",
        revision,
      });
      firstResponse.resolve(AsyncResult.success(snapshot(requested)));
      await response.promise;
    });

    expect(await response.promise).toMatchObject({ ok: false });
    expect(readThreadPreviewState(threadRef).serverEpoch).toBe("replacement-server");
    expect(readThreadPreviewState(threadRef).sessions[tabId]?.viewport).toEqual(newer);
    expect(mocks.resize).toHaveBeenCalledTimes(1);
    expect(mocks.setViewport).not.toHaveBeenCalled();
  });

  it("does not compensate a timed-out legacy response after newer mutations return to the same size", async () => {
    vi.useFakeTimers();
    const firstStarted = deferred<void>();
    const firstResponse = deferred<ReturnType<typeof AsyncResult.success<PreviewResizeResult>>>();
    mocks.resize.mockImplementationOnce(async ({ input }) => {
      persisted = input.viewport;
      firstStarted.resolve();
      return firstResponse.promise;
    });
    const response = deferred<PreviewAutomationResponse>();
    mocks.respond.mockImplementation(async ({ input }) => response.resolve(input));
    const unsubscribe = subscribeBrowserViewportChange(runtimeTabId, async (viewport) => {
      const result = await mocks.resize({ environmentId, input: { threadId, tabId, viewport } });
      if (result._tag === "Failure") throw new Error("Unexpected resize failure");
      updatePreviewServerSnapshot(threadRef, result.value);
    });

    try {
      await act(async () => {
        sendResize();
        await firstStarted.promise;
        await vi.advanceTimersByTimeAsync(800);
        await response.promise;
        for (const viewport of [newer, requested]) {
          await commitBrowserViewportChange(runtimeTabId, viewport);
        }
        firstResponse.resolve(AsyncResult.success(snapshot(requested)));
        await firstResponse.promise;
      });

      expect(persisted).toEqual(requested);
      expect(readThreadPreviewState(threadRef).sessions[tabId]?.viewport).toEqual(requested);
      expect(mocks.resize).toHaveBeenCalledTimes(3);
      expect(mocks.setViewport).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });
});
