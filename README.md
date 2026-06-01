# Dot X Stream Deck

Standalone Elgato Stream Deck plugin for Dot X. Each Stream Deck key can be mapped to a Dot X channel, show the channel target, temporarily show the live slider percentage while moving, and react when buttons are pressed.

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
