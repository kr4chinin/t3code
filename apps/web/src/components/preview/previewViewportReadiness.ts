import type { PreviewRenderedViewportSize, PreviewViewportSetting } from "@t3tools/contracts";

import { browserViewportSettingKey } from "~/browser/browserViewportLayout";

export function isPreviewViewportReady(input: {
  readonly setting: PreviewViewportSetting;
  readonly appliedSettingKey: string | null;
  readonly declaredViewport: PreviewRenderedViewportSize | null;
  readonly renderedViewport: PreviewRenderedViewportSize | null;
}): boolean {
  const { setting, appliedSettingKey, declaredViewport, renderedViewport } = input;
  if (
    appliedSettingKey !== browserViewportSettingKey(setting) ||
    declaredViewport === null ||
    renderedViewport === null
  ) {
    return false;
  }

  const expectedViewport =
    setting._tag === "fill" ? declaredViewport : { width: setting.width, height: setting.height };
  if (
    setting._tag !== "fill" &&
    (declaredViewport.width !== expectedViewport.width ||
      declaredViewport.height !== expectedViewport.height)
  ) {
    return false;
  }

  // CDP fixed dimensions are integer DIP. At the supported minimum page zoom
  // of 0.25, half a DIP becomes two CSS pixels. Fill has no metrics conversion.
  const tolerance = setting._tag === "fill" ? 1 : 2;
  return (
    Math.abs(renderedViewport.width - expectedViewport.width) <= tolerance &&
    Math.abs(renderedViewport.height - expectedViewport.height) <= tolerance
  );
}
