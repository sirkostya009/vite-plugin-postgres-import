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
		transform: {
			filter: {
				id: /\.sql$/,
			},
			handler: transform,
		},
		async configureServer(server) {
			server.watcher.on("add", async (path) => transform(await fs.readFile(path, "utf8"), path));

			await walkdir(rootFolder);

			async function walkdir(/** @type {string} */ p) {
				for await (const entry of await fs.opendir(p)) {
					const entryPath = path.join(entry.parentPath, entry.name);
					if (entry.isFile()) {
						await transform(await fs.readFile(entryPath, "utf8"), entryPath);
					} else if (entry.isDirectory()) {
						await walkdir(entryPath);
					}
				}
			}
		},
		handleHotUpdate({ modules }) {
			return modules;
		},
	};

	/** @returns {Promise<import("vite").TransformResult>} */
	async function transform(/** @type {string} */ sql, /** @type {string} */ id) {
		const filename = path.basename(id, ".sql");

		const { js, dts } = codegen(parseModule(sql), filename, modulePrefix);

		const dtsFolder = path.join(typesFolder, path.relative(rootFolder, path.dirname(id)));
		await fs.mkdir(dtsFolder, { recursive: true });
		await fs.writeFile(path.join(dtsFolder, filename + ".sql.d.ts"), dts);

		return {
			code: js,
			moduleType: "js",
		};
	}
}
