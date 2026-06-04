import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import sharp from "sharp";

const files = [
  ["src/ui/channel-key.html", "com.dotmatrixlabs.dotx.streamdeck.sdPlugin/ui/channel-key.html"],
  ["src/ui/sdpi-components.js", "com.dotmatrixlabs.dotx.streamdeck.sdPlugin/ui/sdpi-components.js"],
  ["src/ui/no-bg.svg", "com.dotmatrixlabs.dotx.streamdeck.sdPlugin/imgs/actions/category/icon.svg"],
  ["src/ui/no-bg.svg", "com.dotmatrixlabs.dotx.streamdeck.sdPlugin/imgs/actions/channel/icon.svg"],
  ["src/ui/transparent-key.svg", "com.dotmatrixlabs.dotx.streamdeck.sdPlugin/imgs/actions/channel/transparent.svg"],
];

for (const [from, to] of files) {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}

console.log(`Copied ${files.length} static Stream Deck assets.`);

// Generate plugin-level PNG icons from the SVG source.
const pluginIconDir = "com.dotmatrixlabs.dotx.streamdeck.sdPlugin/imgs/plugin";
mkdirSync(pluginIconDir, { recursive: true });
await sharp("src/ui/dot-x.svg").resize(72, 72).png().toFile(join(pluginIconDir, "icon.png"));
await sharp("src/ui/dot-x.svg").resize(144, 144).png().toFile(join(pluginIconDir, "icon@2x.png"));
console.log("Generated plugin icons from dot-x.svg.");

// Ensure bin/package.json marks the directory as CJS so Node.js doesn't
// treat the rollup CJS bundle as ESM (root package.json has "type":"module").
import { writeFileSync } from "node:fs";
const binDir = "com.dotmatrixlabs.dotx.streamdeck.sdPlugin/bin";
mkdirSync(binDir, { recursive: true });
writeFileSync(join(binDir, "package.json"), '{"type":"commonjs"}\n');

// Copy the compiled Rust sidecar if it exists.
const sidecarSrc = "sidecar/target/release/media-control.exe";
const sidecarDst = "com.dotmatrixlabs.dotx.streamdeck.sdPlugin/bin/media-control.exe";
if (existsSync(sidecarSrc)) {
  mkdirSync(dirname(sidecarDst), { recursive: true });
  copyFileSync(sidecarSrc, sidecarDst);
  console.log("Copied sidecar: media-control.exe");
} else {
  console.warn("Sidecar not built — run `npm run build:sidecar` first.");
}
