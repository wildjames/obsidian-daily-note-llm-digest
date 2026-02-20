import {readFile, writeFile} from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const typeIndex = args.indexOf("--type");
const releaseType = typeIndex >= 0 ? args[typeIndex + 1] : "minor";
const dryRun = args.includes("--dry-run");

const allowedTypes = new Set(["patch", "minor", "major"]);
if (!allowedTypes.has(releaseType)) {
  throw new Error(`Unsupported release type: ${releaseType}`);
}

const root = process.cwd();
const manifestPath = path.join(root, "manifest.json");
const packagePath = path.join(root, "package.json");
const versionsPath = path.join(root, "versions.json");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
const versions = JSON.parse(await readFile(versionsPath, "utf8"));

const currentVersion = manifest.version;
const minAppVersion = manifest.minAppVersion;

if (!currentVersion) {
  throw new Error("manifest.json is missing version");
}
if (!minAppVersion) {
  throw new Error("manifest.json is missing minAppVersion");
}

const bumpVersion = (version, type) => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`Invalid semver version: ${version}`);
  }

  const major = Number.parseInt(match[1], 10);
  const minor = Number.parseInt(match[2], 10);
  const patch = Number.parseInt(match[3], 10);

  if (type === "major") {
    return `${major + 1}.0.0`;
  }
  if (type === "minor") {
    return `${major}.${minor + 1}.0`;
  }
  return `${major}.${minor}.${patch + 1}`;
};

const nextVersion = bumpVersion(currentVersion, releaseType);

if (dryRun) {
  console.log(nextVersion);
  process.exit(0);
}

if (versions[nextVersion]) {
  throw new Error(`versions.json already contains ${nextVersion}`);
}

manifest.version = nextVersion;
packageJson.version = nextVersion;
versions[nextVersion] = minAppVersion;

await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
await writeFile(packagePath, JSON.stringify(packageJson, null, 2) + "\n", "utf8");
await writeFile(versionsPath, JSON.stringify(versions, null, 2) + "\n", "utf8");

console.log(nextVersion);
