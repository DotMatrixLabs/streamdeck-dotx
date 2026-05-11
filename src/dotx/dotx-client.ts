import { io, type Socket } from "socket.io-client";

export type DotXConnectionConfig = {
  host: string;
  port: number;
};

export type DotXConnectionState = "offline" | "connecting" | "connected";

export type DeviceChanges = {
  changes: Array<{ index: number; oldValue: number; newValue: number }>;
  values: Array<{ value: number }>;
  sliders?: number[];
};

type DeviceInfo = {
  name: string;
  port: string;
  state: string;
  connected_at?: string;
};

type ApiResponse<T = unknown> = {
  request_id: string;
  success: boolean;
  data?: T;
  error?: string;
};

type DeviceUpdateListener = (data: DeviceChanges) => void | Promise<void>;
type StateListener = (state: DotXConnectionState) => void | Promise<void>;

const PLUGIN_INFO = {
  id: "dotx-streamdeck",
  name: "Dot X Stream Deck",
  version: "0.1.0",
};
const DOTX_HOST = "127.0.0.1";
const DOTX_PORT_START = 3001;
const DOTX_PORT_END = 3099;
const CONNECT_TIMEOUT_MS = 450;
const API_TIMEOUT_MS = 5000;

export class DotXClient {
  private socket?: Socket;
  private connection?: Promise<void>;
  private config?: DotXConnectionConfig;
  private registered = false;
  private state: DotXConnectionState = "offline";
  private readonly deviceUpdateListeners = new Set<DeviceUpdateListener>();
  private readonly stateListeners = new Set<StateListener>();

  getState(): DotXConnectionState {
    return this.state;
  }

  onDeviceUpdate(listener: DeviceUpdateListener): () => void {
    this.deviceUpdateListeners.add(listener);
    return () => this.deviceUpdateListeners.delete(listener);
  }

  onStateChange(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  async ensureConnected(config?: DotXConnectionConfig): Promise<void> {
    const targetConfig = config ?? this.config;

    if (this.registered && this.socket?.connected && (!targetConfig || this.isSameConfig(targetConfig))) {
      return;
    }

    if (this.connection && (!targetConfig || this.isSameConfig(targetConfig))) {
      return this.connection;
    }

    this.connection = (config ? this.connectToConfig(config) : this.discoverAndConnect())
      .finally(() => {
        this.connection = undefined;
      });

    return this.connection;
  }

  async getChannelTargets(channel: number): Promise<string[]> {
    const response = await this.call<{ channel: string; targets: string[] }>("channelTargets.getForChannel", { channel });
    return Array.isArray(response.targets) ? response.targets : [];
  }

  async getConnectedDevices(): Promise<DeviceInfo[]> {
    const response = await this.call<{ devices: DeviceInfo[] }>("device.getConnected", {});
    return Array.isArray(response.devices) ? response.devices : [];
  }

  disconnect(): void {
    this.connection = undefined;
    this.registered = false;
    if (this.socket) {
      this.socket.disconnect();
    }
    this.socket = undefined;
  }

  private async call<T>(method: string, params: unknown): Promise<T> {
    if (!this.registered || !this.socket?.connected) {
      this.markOffline();
      throw new Error("Dot X is not connected");
    }

    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Dot X API request timed out: ${method}`));
      }, API_TIMEOUT_MS);

      this.socket?.emit(
        "api_request",
        {
          method,
          params,
          request_id: requestId,
        },
        (response: ApiResponse<T>) => {
          clearTimeout(timeout);
          if (response?.success) {
            resolve(response.data as T);
            return;
          }

          this.markOffline();
          reject(new Error(response?.error || `Dot X API request failed: ${method}`));
        },
      );
    });
  }

  private isSameConfig(config: DotXConnectionConfig): boolean {
    return this.config?.host === config.host && this.config?.port === config.port;
  }

  private async discoverAndConnect(): Promise<void> {
    const ports = buildPortCandidates(this.config?.port);
    let lastError: unknown;

    for (const port of ports) {
      try {
        await this.connectToConfig({ host: DOTX_HOST, port });
        console.log(`[Dot X Stream Deck] Connected to Dot X plugin server on ${DOTX_HOST}:${port}`);
        return;
      } catch (error) {
        lastError = error;
      }
    }

    this.markOffline();
    throw new Error(`Could not find Dot X plugin server on ${DOTX_HOST}:${DOTX_PORT_START}-${DOTX_PORT_END}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  private async connectToConfig(config: DotXConnectionConfig): Promise<void> {
    this.disconnect();
    this.config = { ...config };
    this.setState("connecting");

    const socket = io(`http://${config.host}:${config.port}`, {
      timeout: CONNECT_TIMEOUT_MS,
      forceNew: true,
      autoConnect: true,
      reconnection: false,
    });

    this.socket = socket;
    socket.on("plugin.device_update", (data: unknown) => {
      void this.emitDeviceUpdate(normalizeDeviceChanges(data));
    });
    socket.on("plugin.device_disconnected", () => {
      this.registered = false;
      this.setState("offline");
    });
    socket.on("plugin.device_connected", () => {
      if (this.registered) {
        this.setState("connected");
      }
    });
    socket.on("disconnect", () => {
      this.registered = false;
      this.setState("offline");
    });

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        socket.disconnect();
        reject(new Error(`Timed out connecting to ${config.host}:${config.port}`));
      }, CONNECT_TIMEOUT_MS + 150);

      const cleanup = () => {
        clearTimeout(timeout);
        socket.off("connect", onConnect);
        socket.off("connect_error", onError);
        socket.off("error", onError);
      };

      const onError = (error: Error) => {
        cleanup();
        socket.disconnect();
        reject(error);
      };

      const onConnect = () => {
        socket.emit(
          "register",
          {
            ...PLUGIN_INFO,
            connected_at: new Date().toISOString(),
          },
          (ack: { status?: string; message?: string }) => {
            cleanup();
            if (ack?.status === "success") {
              this.registered = true;
              this.setState("connected");
              resolve();
              return;
            }

            socket.disconnect();
            reject(new Error(`Dot X plugin registration failed: ${ack?.message || "Unknown error"}`));
          },
        );
      };

      socket.on("connect", onConnect);
      socket.on("connect_error", onError);
      socket.on("error", onError);
    }).catch((error) => {
      if (this.socket === socket) {
        this.markOffline();
        this.socket = undefined;
      }

      throw error;
    });
  }

  private markOffline(): void {
    this.registered = false;
    this.setState("offline");
  }

  private async emitDeviceUpdate(data: DeviceChanges): Promise<void> {
    await Promise.all([...this.deviceUpdateListeners].map(async (listener) => {
      try {
        await listener(data);
      } catch (error) {
        console.error("[Dot X Stream Deck] Device update listener failed:", error);
      }
    }));
  }

  private setState(state: DotXConnectionState): void {
    if (this.state === state) {
      return;
    }

    this.state = state;
    for (const listener of this.stateListeners) {
      void listener(state);
    }
  }
}

export const dotxClient = new DotXClient();

function buildPortCandidates(lastKnownPort?: number): number[] {
  const ports = [];
  if (lastKnownPort && lastKnownPort >= DOTX_PORT_START && lastKnownPort <= DOTX_PORT_END) {
    ports.push(lastKnownPort);
  }

  for (let port = DOTX_PORT_START; port <= DOTX_PORT_END; port += 1) {
    if (port !== lastKnownPort) {
      ports.push(port);
    }
  }

  return ports;
}

function normalizeDeviceChanges(data: unknown): DeviceChanges {
  const payload = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const rawSliders = Array.isArray(payload.sliders) ? payload.sliders : [];
  const rawValues = Array.isArray(payload.values) ? payload.values : rawSliders.map((value) => ({ value }));
  const values = rawValues
    .map((entry) => {
      if (typeof entry === "number") {
        return { value: entry };
      }

      if (entry && typeof entry === "object") {
        const value = Number((entry as { value?: unknown }).value);
        return Number.isFinite(value) ? { value } : undefined;
      }

      return undefined;
    })
    .filter((entry): entry is { value: number } => entry !== undefined);

  const rawChanges = Array.isArray(payload.changes) ? payload.changes : [];
  const changes = rawChanges
    .map((entry, fallbackIndex) => {
      if (!entry || typeof entry !== "object") {
        return undefined;
      }

      const change = entry as { index?: unknown; oldValue?: unknown; newValue?: unknown };
      const index = Number.isFinite(Number(change.index)) ? Number(change.index) : fallbackIndex;
      const oldValue = Number(change.oldValue);
      const newValue = Number(change.newValue);

      if (!Number.isFinite(newValue)) {
        return undefined;
      }

      return {
        index,
        oldValue: Number.isFinite(oldValue) ? oldValue : values[index]?.value ?? 0,
        newValue,
      };
    })
    .filter((entry): entry is { index: number; oldValue: number; newValue: number } => entry !== undefined);

  if (changes.length === 0 && values.length > 0) {
    return {
      changes: values.map((entry, index) => ({
        index,
        oldValue: entry.value,
        newValue: entry.value,
      })),
      values,
      sliders: rawSliders.filter((value): value is number => typeof value === "number"),
    };
  }

  return {
    changes,
    values,
    sliders: rawSliders.filter((value): value is number => typeof value === "number"),
  };
}
