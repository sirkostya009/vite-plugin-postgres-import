import fs from "node:fs/promises";
import path from "node:path";
import { codegen, parseModule } from "./parse.js";

/** @returns {import('vite').Plugin} */
export default function postgres({
	typesFolder = "node_modules/@types/vite-plugin-postgres-import/",
	modulePrefix = "",
	rootFolder = process.cwd(),
} = {}) {
	return {
		name: "vite-plugin-sql-postgres",
		resolveId(id) {
			if (id.endsWith(".sql")) {
				return id;
			}
		},
		load,
		async configureServer(server) {
			server.watcher.on("add", load);

			await walkdir(rootFolder);

			async function walkdir(/** @type {string} */ p) {
				for await (const entry of await fs.opendir(p)) {
					if (entry.isFile()) {
						await load(path.relative(rootFolder, path.join(entry.parentPath, entry.name)));
					} else if (entry.isDirectory()) {
						await walkdir(path.join(entry.parentPath, entry.name));
					}
				}
			}
		},
		handleHotUpdate({ modules }) {
			return modules;
		},
	};

	async function load(/** @type {string} */ id) {
		if (!id.endsWith(".sql")) return null;
		const sql = await fs.readFile(id, "utf8");

		const filename = path.basename(id, ".sql");

		const { js, dts } = codegen(parseModule(sql), filename, modulePrefix);

		const dtsFolder = path.join(typesFolder, path.relative(rootFolder, path.dirname(id)));
		await fs.mkdir(dtsFolder, { recursive: true });
		await fs.writeFile(path.join(dtsFolder, filename + ".sql.d.ts"), dts);

		return js;
	}
}
