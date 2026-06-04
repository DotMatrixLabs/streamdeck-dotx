# Dot X Stream Deck

Standalone Elgato Stream Deck plugin for Dot X. Each Stream Deck key can be mapped to a Dot X channel, show the channel target, temporarily show the live slider percentage while moving, and react when buttons are pressed.

## About

Stream Deck plugin for [Dot X](https://dotmatrixlabs.com). Maps Stream Deck keys to Dot X channels and displays live channel information.

Includes one action: **Dot X Channel**.

- Shows the channel's target label on the key. Display modes: first target, all targets, or a custom label.
- Optionally shows the live slider percentage while a channel is being adjusted, then returns to the label after a configurable hold time (250 ms – 10 s).
- Optionally triggers a media action on key press: play/pause, next track, previous track, mute, or mute the channel's audio session.
- Connects to Dot X over a local WebSocket. Automatically discovers the port Dot X is running on (3001–3099). Shows "offline" or "connecting" on the key when Dot X is unreachable.

## Requirements

- Dot X running locally with the plugin server enabled.
- Stream Deck 7.1 or newer.
- Node.js 24 or newer for development.

## Development

```bash
npm install
npm run typecheck
npm run build
npm run validate
```

During development, run:

```bash
npm run watch
```

The compiled plugin lives in `com.dotmatrixlabs.dotx.streamdeck.sdPlugin`.

## Packaging

```bash
npm run package
```

The installable artifact is written to:

```text
dist/com.dotmatrixlabs.dotx.streamdeck.streamDeckPlugin
```

## Action Settings

- `channel`: Dot X channel number, default `0`.
- `displayMode`: `first`, `all`, or `custom`.
- `customLabel`: optional label used when display mode is `custom`.
- `showPercentWhileMoving`: show the slider percentage while the mapped channel changes.
- `percentHoldMs`: how long to keep the percentage visible before returning to the target label.

## Notes

Dot X may start the plugin server on another port if `3001` is busy. The Stream Deck plugin automatically probes `127.0.0.1:3001-3099` and reuses the last working port.
