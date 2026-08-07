const fs = require("fs");
const path = require("path");

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"));
const version = pkg.version;

// Update plugin.json version
const pluginPath = path.join(__dirname, "..", "plugin.json");
const plugin = JSON.parse(fs.readFileSync(pluginPath, "utf-8"));
plugin.version = version;
fs.writeFileSync(pluginPath, JSON.stringify(plugin, null, 2) + "\n");

console.log(`Version synced: plugin.json → ${version}`);
