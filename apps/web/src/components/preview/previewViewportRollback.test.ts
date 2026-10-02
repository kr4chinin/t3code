import { ThreadId, type PreviewResizeResult } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  applyPreviewViewportRollback,
  createPreviewViewportRollbackState,
} from "./previewViewportRollback";

describe("preview viewport rollback", () => {
  const requested = { _tag: "freeform", width: 900, height: 600 } as const;

  it("uses the server predecessor and write version for a guarded rollback", () => {
    const previous = { _tag: "freeform", width: 800, height: 600 } as const;
    const stateVersion = { serverEpoch: "server-a", revision: 4 } as const;
    const rollback = createPreviewViewportRollbackState({
      threadId: ThreadId.make("thread-1"),
      tabId: "tab-1",
      previousSetting: { _tag: "fill" },
      result: {
        threadId: ThreadId.make("thread-1"),
        tabId: "tab-1",
        navStatus: { _tag: "Idle" },
        canGoBack: false,
        canGoForward: false,
        viewport: requested,
        updatedAt: "2026-01-01T00:00:00.000Z",
        stateVersion,
        previousViewport: previous,
      },
    });

    expect(rollback).toEqual({
      previousSetting: previous,
      stateVersion,
      input: {
        threadId: ThreadId.make("thread-1"),
        tabId: "tab-1",
        viewport: previous,
        expectedStateVersion: stateVersion,
      },
    });
    expect(rollback?.input.expectedStateVersion).toBe(stateVersion);
  });

  it("keeps available server metadata and falls back to the local predecessor", () => {
    const result = {
      threadId: ThreadId.make("thread-1"),
      tabId: "tab-1",
      navStatus: { _tag: "Idle" as const },
      canGoBack: false,
      canGoForward: false,
      viewport: requested,
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const create = (resizeResult: PreviewResizeResult) =>
      createPreviewViewportRollbackState({
        threadId: ThreadId.make("thread-1"),
        tabId: "tab-1",
        previousSetting: { _tag: "fill" },
        result: resizeResult,
      });

    expect(create(result).input).toEqual({
      threadId: ThreadId.make("thread-1"),
      tabId: "tab-1",
      viewport: { _tag: "fill" },
    });
    expect(
      create({ ...result, stateVersion: { serverEpoch: "server-a", revision: 2 } }),
    ).toMatchObject({
      input: {
        viewport: { _tag: "fill" },
        expectedStateVersion: { serverEpoch: "server-a", revision: 2 },
      },
    });
    const serverPrevious = { _tag: "freeform", width: 700, height: 500 } as const;
    expect(create({ ...result, previousViewport: serverPrevious }).previousSetting).toEqual(
      serverPrevious,
    );
  });

  it("changes the guest only after the guarded server rollback succeeds", async () => {
    const previous = { _tag: "freeform", width: 800, height: 600 } as const;
    const order: string[] = [];
    const applyGuest = vi.fn(async () => {
      order.push("guest");
    });

    await applyPreviewViewportRollback({
      previous,
      applyGuest,
      rollbackServer: async () => {
        order.push("server");
        return true;
      },
    });

    expect(order).toEqual(["server", "guest"]);
    expect(applyGuest).toHaveBeenCalledOnce();
    expect(applyGuest).toHaveBeenCalledWith(previous);
  });

  it("leaves the guest unchanged when the guarded rollback conflicts", async () => {
    const previous = { _tag: "freeform", width: 800, height: 600 } as const;
    const applyGuest = vi.fn(async () => undefined);

    await applyPreviewViewportRollback({
      previous,
      applyGuest,
      rollbackServer: async () => false,
    });

    expect(applyGuest).not.toHaveBeenCalled();
  });

  it("leaves the guest unchanged when the server rollback throws", async () => {
    const previous = { _tag: "freeform", width: 800, height: 600 } as const;
    const applyGuest = vi.fn(async () => undefined);

    await expect(
      applyPreviewViewportRollback({
        previous,
        applyGuest,
        rollbackServer: async () => {
          throw new Error("rollback unavailable");
        },
      }),
    ).rejects.toThrow("rollback unavailable");
    expect(applyGuest).not.toHaveBeenCalled();
  });
});
