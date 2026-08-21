const fs = require("fs");
const path = require("path");
const { getConfig } = require("./session-store");

/**
 * Resolves the output file path for an export, relative to the current
 * working directory.
 *
 * @param {string} [out] - A directory, or an exact `.json` file path.
 *   Falls back to `config.out`, then the current directory.
 * @returns {string} Absolute path to the file the export should be written to.
 */
function resolveOutFile(out) {
  const config = getConfig();
  const target = out || config.out || ".";
  const resolved = path.resolve(process.cwd(), target);

  if (resolved.toLowerCase().endsWith(".json")) {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    return resolved;
  }

  fs.mkdirSync(resolved, { recursive: true });
  return path.join(
    resolved,
    `export-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
}

/**
 * Writes export data to disk as JSON.
 *
 * @param {Object} data - The data to serialize.
 * @param {string} [out] - A directory, or an exact `.json` file path.
 * @returns {string} Absolute path to the file that was written.
 */
function writeExport(data, out) {
  const outFile = resolveOutFile(out);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(
    outFile,
    JSON.stringify({ generatedAt: new Date().toISOString(), ...data }, null, 2),
  );
  return outFile;
}

module.exports = { writeExport };
