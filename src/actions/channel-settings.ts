import type { JsonObject } from "@elgato/utils";

export type ChannelDisplayMode = "first" | "all" | "custom";

export type MediaAction =
  | "none"
  | "toggle-mute"
  | "toggle"
  | "next"
  | "prev";

export type ChannelKeySettings = JsonObject & {
  channel?: number | string;
  showPercentWhileMoving?: boolean;
  percentHoldMs?: number;
  displayMode?: ChannelDisplayMode;
  customLabel?: string;
  mediaAction?: MediaAction;
};

export type NormalizedChannelKeySettings = {
  channel: number;
  showPercentWhileMoving: boolean;
  percentHoldMs: number;
  displayMode: ChannelDisplayMode;
  customLabel: string;
  mediaAction: MediaAction;
};

export function normalizeChannelSettings(settings?: ChannelKeySettings): NormalizedChannelKeySettings {
  const channel = toInteger(settings?.channel, 0, 0, 999);
  const percentHoldMs = toInteger(settings?.percentHoldMs, 1200, 250, 10000);
  const displayMode = settings?.displayMode === "all" || settings?.displayMode === "custom"
    ? settings.displayMode
    : "first";

  return {
    channel,
    showPercentWhileMoving: settings?.showPercentWhileMoving !== false,
    percentHoldMs,
    displayMode,
    customLabel: typeof settings?.customLabel === "string" ? settings.customLabel.trim() : "",
    mediaAction: isMediaAction(settings?.mediaAction) ? settings!.mediaAction! : "none",
  };
}

function isMediaAction(value: unknown): value is MediaAction {
  return (
    value === "none" ||
    value === "toggle-mute" ||
    value === "toggle" ||
    value === "next" ||
    value === "prev"
  );
}

function toInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}
