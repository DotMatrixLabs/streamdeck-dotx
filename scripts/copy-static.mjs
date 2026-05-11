import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const files = [
  ["src/ui/channel-key.html", "com.dotmatrixlabs.dotx.streamdeck.sdPlugin/ui/channel-key.html"],
  ["src/ui/sdpi-components.js", "com.dotmatrixlabs.dotx.streamdeck.sdPlugin/ui/sdpi-components.js"],
  ["src/ui/channel-icon.svg", "com.dotmatrixlabs.dotx.streamdeck.sdPlugin/imgs/actions/channel/icon.svg"],
  ["src/ui/transparent-key.svg", "com.dotmatrixlabs.dotx.streamdeck.sdPlugin/imgs/actions/channel/transparent.svg"],
];

for (const [from, to] of files) {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}

console.log(`Copied ${files.length} static Stream Deck assets.`);
