import {createHash} from "node:crypto";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

const root = process.cwd();
const releaseDir = path.join(root, "release");

const manifestPath = path.join(root, "manifest.json");
const manifestRaw = await readFile(manifestPath, "utf8");
const manifest = JSON.parse(manifestRaw);

const pluginId = manifest.id;
const pluginVersion = manifest.version;

if (!pluginId || !pluginVersion) {
  throw new Error("manifest.json must contain id and version");
}

const releaseFiles = ["main.js", "manifest.json", "styles.css"];

await mkdir(releaseDir, {recursive: true});

const fileBuffers = [];
for (const fileName of releaseFiles) {
  const filePath = path.join(root, fileName);
  const buffer = await readFile(filePath);
  fileBuffers.push({fileName, buffer});
}

const zip = new JSZip();
for (const {fileName, buffer} of fileBuffers) {
  zip.file(fileName, buffer);
}

const zipFileName = `${pluginId}-${pluginVersion}.zip`;
const zipPath = path.join(releaseDir, zipFileName);
const zipBuffer = await zip.generateAsync({
  type: "nodebuffer",
  compression: "DEFLATE",
  compressionOptions: {level: 9}
});
await writeFile(zipPath, zipBuffer);

const hashOf = (buffer) => createHash("sha256").update(buffer).digest("hex");

const releaseManifest = {
  id: pluginId,
  version: pluginVersion,
  generatedAt: new Date().toISOString(),
  artifacts: [
    {
      file: zipFileName,
      path: `release/${zipFileName}`,
      sha256: hashOf(zipBuffer)
    },
    ...fileBuffers.map(({fileName, buffer}) => ({
      file: fileName,
      path: fileName,
      sha256: hashOf(buffer)
    }))
  ]
};

const releaseManifestPath = path.join(releaseDir, "release-manifest.json");
await writeFile(releaseManifestPath, JSON.stringify(releaseManifest, null, 2) + "\n", "utf8");

console.log(`Created ${zipPath}`);
console.log(`Created ${releaseManifestPath}`);
