import fs from "node:fs/promises";
import path from "node:path";
import { codegen, parseLocalSvelteConfigAliases, parseModule } from "./parse.js";

/** @returns {import('vite').Plugin} */
export default async function postgres({
	typesFolder = "node_modules/@types/vite-plugin-postgres-import/",
	rootFolder = process.cwd(),
} = {}) {
	const aliases = await parseLocalSvelteConfigAliases();

	const moduleDeclarations = new Map();

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
		if (!/\.sql$/.test(id)) {
			return;
		}
		const filename = path.relative(rootFolder, id);

		const { js, dts, moduleDeclaration } = codegen(parseModule(sql), filename, aliases);

		const dtsFolder = path.join(typesFolder, path.relative(rootFolder, path.dirname(id)));
		await fs.mkdir(dtsFolder, { recursive: true });
		await fs.writeFile(path.join(dtsFolder, path.basename(filename, ".sql") + ".sql.d.ts"), dts);
		if (moduleDeclaration.length) {
			moduleDeclarations.set(filename, moduleDeclaration.join("\n"));
			await fs.writeFile(path.join(typesFolder, "modules.sql.d.ts"), [...moduleDeclarations.values()].join("\n"));
		}

		return {
			code: js,
			moduleType: "js",
		};
	}
}
