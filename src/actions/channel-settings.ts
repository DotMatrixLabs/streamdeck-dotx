import type { JsonObject } from "@elgato/utils";

export type ChannelDisplayMode = "first" | "all" | "custom";

export type MediaAction =
  | "none"
  | "toggle-mute"
  | "session-toggle-mute"
  | "toggle"
  | "session-toggle"
  | "play"
  | "pause"
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

export function isSessionAction(action: MediaAction): boolean {
  return action === "session-toggle" || action === "session-toggle-mute";
}

function isMediaAction(value: unknown): value is MediaAction {
  return (
    value === "none" ||
    value === "toggle-mute" ||
    value === "session-toggle-mute" ||
    value === "toggle" ||
    value === "session-toggle" ||
    value === "play" ||
    value === "pause" ||
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
