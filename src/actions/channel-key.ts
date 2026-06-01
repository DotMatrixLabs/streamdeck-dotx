import { execFile } from "child_process";
import { join } from "path";
import streamDeck, {
  action,
  SingletonAction,
  type DidReceiveSettingsEvent,
  type KeyAction,
  type KeyDownEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import { dotxClient, type DeviceChanges, type DotXConnectionState } from "../dotx/dotx-client.js";
import {
  normalizeChannelSettings,
  type ChannelKeySettings,
  type NormalizedChannelKeySettings,
} from "./channel-settings.js";

const SIDECAR = join(__dirname, "media-control.exe");

const ACTION_UUID = "com.dotmatrixlabs.dotx.streamdeck.channel";
const TARGET_REFRESH_MS = 10_000;
const TITLE_DEBOUNCE_MS = 80;
const TITLE_MAX_LINES = 3;
const TITLE_MAX_LINE_LENGTH = 8;
const TITLE_MAX_TOTAL_LENGTH = TITLE_MAX_LINES * TITLE_MAX_LINE_LENGTH;
const TRANSPARENT_KEY_IMAGE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='144' height='144' viewBox='0 0 144 144'%3E%3C/svg%3E";

type VisibleChannelAction = {
  action: KeyAction<ChannelKeySettings>;
  settings: NormalizedChannelKeySettings;
  targets: string[];
  currentValue?: number;
  titleTimer?: NodeJS.Timeout;
  percentTimer?: NodeJS.Timeout;
  pendingTitle?: string;
};

@action({ UUID: ACTION_UUID })
export class ChannelKeyAction extends SingletonAction<ChannelKeySettings> {
  private readonly visible = new Map<string, VisibleChannelAction>();
  private refreshTimer?: NodeJS.Timeout;

  constructor() {
    super();
    dotxClient.onDeviceUpdate((data) => this.handleDeviceUpdate(data));
    dotxClient.onStateChange((state) => this.handleConnectionState(state));
  }

  override async onWillAppear(ev: WillAppearEvent<ChannelKeySettings>): Promise<void> {
    if (!ev.action.isKey()) {
      return;
    }

    const settings = normalizeChannelSettings(ev.payload.settings);
    this.visible.set(ev.action.id, {
      action: ev.action,
      settings,
      targets: [],
    });

    await ev.action.setImage(TRANSPARENT_KEY_IMAGE);
    await ev.action.setSettings(settings);
    await this.connectAndRefresh(ev.action.id);
    this.ensureRefreshTimer();
  }

  override onWillDisappear(ev: WillDisappearEvent<ChannelKeySettings>): void {
    const visible = this.visible.get(ev.action.id);
    if (visible?.titleTimer) {
      clearTimeout(visible.titleTimer);
    }
    if (visible?.percentTimer) {
      clearTimeout(visible.percentTimer);
    }

    this.visible.delete(ev.action.id);

    if (this.visible.size === 0 && this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<ChannelKeySettings>): Promise<void> {
    if (!ev.action.isKey()) {
      return;
    }

    const settings = normalizeChannelSettings(ev.payload.settings);
    const existing = this.visible.get(ev.action.id);
    this.visible.set(ev.action.id, {
      action: ev.action,
      settings,
      targets: existing?.targets ?? [],
      currentValue: existing?.currentValue,
      titleTimer: existing?.titleTimer,
      percentTimer: existing?.percentTimer,
      pendingTitle: existing?.pendingTitle,
    });

    await ev.action.setSettings(settings);
    await this.connectAndRefresh(ev.action.id);
  }

  override async onKeyDown(ev: KeyDownEvent<ChannelKeySettings>): Promise<void> {
    const settings = normalizeChannelSettings(ev.payload.settings);
    if (settings.mediaAction === "none") {
      return;
    }

    await runSidecar(settings.mediaAction).catch((err) => {
      streamDeck.logger.warn("[Dot X Stream Deck] Media control error", {
        action: settings.mediaAction,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  private async connectAndRefresh(actionId?: string): Promise<void> {
    const entries = actionId
      ? [...this.visible.entries()].filter(([id]) => id === actionId)
      : [...this.visible.entries()];

    for (const [id, visible] of entries) {
      try {
        await dotxClient.ensureConnected();
        const targets = await dotxClient.getChannelTargets(visible.settings.channel);
        const current = this.visible.get(id);
        if (!current) {
          continue;
        }

        current.targets = targets;
        this.queueTitle(current, this.getTargetTitle(current));
      } catch (error) {
        streamDeck.logger.warn("[Dot X Stream Deck] Unable to refresh Dot X channel", {
          actionId: id,
          channel: visible.settings.channel,
          error: error instanceof Error ? error.message : String(error),
        });
        this.queueTitle(visible, "Dot X\noffline");
      }
    }
  }

  private handleDeviceUpdate(data: DeviceChanges): void {
    const nextValues = new Map<number, number>();

    const values = Array.isArray(data.values) ? data.values : [];
    const changes = Array.isArray(data.changes) ? data.changes : [];

    values.forEach((value, index) => {
      if (Number.isFinite(value.value)) {
        nextValues.set(index, value.value);
      }
    });

    for (const change of changes) {
      if (Number.isFinite(change.newValue)) {
        nextValues.set(change.index, change.newValue);
      }
    }

    for (const visible of this.visible.values()) {
      const value = nextValues.get(visible.settings.channel);
      if (value === undefined || value === visible.currentValue) {
        continue;
      }

      visible.currentValue = value;
      if (visible.settings.showPercentWhileMoving) {
        this.showPercentTemporarily(visible, value);
      }
    }
  }

  private handleConnectionState(state: DotXConnectionState): void {
    if (state !== "connected") {
      for (const visible of this.visible.values()) {
        this.queueTitle(visible, state === "connecting" ? "Dot X\nconnecting" : "Dot X\noffline");
      }
      return;
    }

    void this.connectAndRefresh();
  }

  private showPercentTemporarily(visible: VisibleChannelAction, value: number): void {
    if (visible.percentTimer) {
      clearTimeout(visible.percentTimer);
    }

    this.queueTitle(visible, `${Math.round(value)}%`);
    visible.percentTimer = setTimeout(() => {
      this.queueTitle(visible, this.getTargetTitle(visible));
    }, visible.settings.percentHoldMs);
  }

  private getTargetTitle(visible: VisibleChannelAction): string {
    if (visible.settings.displayMode === "custom" && visible.settings.customLabel) {
      return visible.settings.customLabel;
    }

    if (visible.targets.length === 0) {
      return `Channel ${visible.settings.channel}`;
    }

    if (visible.settings.displayMode === "all") {
      return visible.targets.join("\n");
    }

    return visible.targets[0] ?? `Channel ${visible.settings.channel}`;
  }

  private queueTitle(visible: VisibleChannelAction, title: string): void {
    visible.pendingTitle = truncateTitle(title);

    if (visible.titleTimer) {
      return;
    }

    visible.titleTimer = setTimeout(async () => {
      const nextTitle = visible.pendingTitle;
      visible.pendingTitle = undefined;
      visible.titleTimer = undefined;

      try {
        await visible.action.setTitle(nextTitle);
      } catch (error) {
        streamDeck.logger.warn("[Dot X Stream Deck] Failed to update Stream Deck title", {
          actionId: visible.action.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, TITLE_DEBOUNCE_MS);
  }

  private ensureRefreshTimer(): void {
    if (this.refreshTimer) {
      return;
    }

    this.refreshTimer = setInterval(() => {
      if (this.visible.size > 0) {
        void this.connectAndRefresh();
      }
    }, TARGET_REFRESH_MS);
  }
}

function runSidecar(command: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(SIDECAR, [command], { timeout: 5000 }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function truncateTitle(title: string): string {
  const clean = title
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");

  if (!clean) {
    return "";
  }

  const lines: string[] = [];

  for (const word of clean.split(/\s+/)) {
    const chunks = splitLongWord(word, TITLE_MAX_LINE_LENGTH);

    for (const chunk of chunks) {
      const currentLine = lines[lines.length - 1];

      if (!currentLine) {
        lines.push(chunk);
      } else if (`${currentLine} ${chunk}`.length <= TITLE_MAX_LINE_LENGTH) {
        lines[lines.length - 1] = `${currentLine} ${chunk}`;
      } else {
        lines.push(chunk);
      }

      if (lines.length > TITLE_MAX_LINES) {
        return trimToMaxLines(lines);
      }
    }
  }

  return trimToMaxLines(lines);
}

function splitLongWord(word: string, maxLength: number): string[] {
  if (word.length <= maxLength) {
    return [word];
  }

  const chunks: string[] = [];
  for (let index = 0; index < word.length; index += maxLength) {
    chunks.push(word.slice(index, index + maxLength));
  }

  return chunks;
}

function trimToMaxLines(lines: string[]): string {
  const limited = lines.slice(0, TITLE_MAX_LINES);
  const joined = limited.join("\n");

  if (joined.length <= TITLE_MAX_TOTAL_LENGTH + TITLE_MAX_LINES - 1 && lines.length <= TITLE_MAX_LINES) {
    return joined;
  }

  const lastIndex = limited.length - 1;
  limited[lastIndex] = `${limited[lastIndex].slice(0, Math.max(0, TITLE_MAX_LINE_LENGTH - 3))}...`;
  return limited.join("\n");
}
