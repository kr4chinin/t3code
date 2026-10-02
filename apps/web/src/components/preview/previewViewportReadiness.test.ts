import { describe, expect, it } from "vite-plus/test";

import { browserViewportSettingKey } from "~/browser/browserViewportLayout";

import { isPreviewViewportReady } from "./previewViewportReadiness";

describe("isPreviewViewportReady", () => {
  const landscape = {
    _tag: "preset",
    width: 844,
    height: 390,
    presetId: "iphone-12-pro",
  } as const;

  it("rejects a stale same-mode preset while React applies the requested orientation", () => {
    expect(
      isPreviewViewportReady({
        setting: landscape,
        appliedSettingKey: "preset:390:844:iphone-12-pro",
        declaredViewport: { width: 390, height: 844 },
        renderedViewport: { width: 390, height: 844 },
      }),
    ).toBe(false);
  });

  it("requires both the declaration and guest viewport to match a fixed request", () => {
    const appliedSettingKey = browserViewportSettingKey(landscape);
    expect(
      isPreviewViewportReady({
        setting: landscape,
        appliedSettingKey,
        declaredViewport: { width: 390, height: 844 },
        renderedViewport: { width: 844, height: 390 },
      }),
    ).toBe(false);
    expect(
      isPreviewViewportReady({
        setting: landscape,
        appliedSettingKey,
        declaredViewport: { width: 844, height: 390 },
        renderedViewport: { width: 844, height: 390 },
      }),
    ).toBe(true);
  });

  it("allows one pixel of Electron rounding tolerance in every mode", () => {
    expect(
      isPreviewViewportReady({
        setting: { _tag: "fill" },
        appliedSettingKey: "fill",
        declaredViewport: { width: 500, height: 700 },
        renderedViewport: { width: 501, height: 699 },
      }),
    ).toBe(true);
    expect(
      isPreviewViewportReady({
        setting: landscape,
        appliedSettingKey: browserViewportSettingKey(landscape),
        declaredViewport: { width: 844, height: 390 },
        renderedViewport: { width: 845, height: 389 },
      }),
    ).toBe(true);
    expect(
      isPreviewViewportReady({
        setting: landscape,
        appliedSettingKey: browserViewportSettingKey(landscape),
        declaredViewport: { width: 844, height: 390 },
        renderedViewport: { width: 847, height: 390 },
      }),
    ).toBe(false);
  });

  it("accepts the measured integer-DIP quantization of an HTTP viewport at quarter zoom", () => {
    const setting = { _tag: "freeform", width: 390, height: 844 } as const;
    expect(
      isPreviewViewportReady({
        setting,
        appliedSettingKey: browserViewportSettingKey(setting),
        declaredViewport: { width: 390, height: 844 },
        renderedViewport: { width: 392, height: 844 },
      }),
    ).toBe(true);
  });

  it("does not widen fill readiness for fixed-viewport quantization", () => {
    expect(
      isPreviewViewportReady({
        setting: { _tag: "fill" },
        appliedSettingKey: "fill",
        declaredViewport: { width: 500, height: 700 },
        renderedViewport: { width: 502, height: 700 },
      }),
    ).toBe(false);
  });

  it("rejects close stale declarations and keys despite the fixed rounding allowance", () => {
    const setting = { _tag: "freeform", width: 390, height: 844 } as const;
    const current = {
      setting,
      appliedSettingKey: browserViewportSettingKey(setting),
      declaredViewport: { width: 390, height: 844 },
      renderedViewport: { width: 392, height: 844 },
    };
    expect(
      isPreviewViewportReady({ ...current, declaredViewport: { width: 392, height: 844 } }),
    ).toBe(false);
    expect(isPreviewViewportReady({ ...current, appliedSettingKey: "freeform:392:844" })).toBe(
      false,
    );
  });
});
