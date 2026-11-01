import fs from "node:fs/promises";
import path from "node:path";
import { describer } from "./describe.js";
import { codegen, encodeMappings, exportMappings, parseModule } from "./parse.js";

/**
 * @import { ClientConfig, QueryArrayConfig, QueryArrayResult, QueryConfig, QueryConfigValues, QueryResult, QueryResultRow, Submittable } from "pg"
 * @import { Plugin, TransformResult } from "vite"
 */

/**
 * Value pg parses `interval` columns into.
 * @typedef {{
 *   years?: number;
 *   months?: number;
 *   days?: number;
 *   hours?: number;
 *   minutes?: number;
 *   seconds?: number;
 *   milliseconds?: number;
 *   toPostgres(): string;
 *   toISO(): string;
 *   toISOString(): string;
 * }} Interval
 */

/**
 * @typedef {{
 *   query<T extends Submittable>(queryStream: T): T;
 *   query<R extends any[] = any[], I = any[]>(queryConfig: QueryArrayConfig<I>, values?: QueryConfigValues<I>): Promise<QueryArrayResult<R>>;
 *   query<R extends QueryResultRow = any, I = any>(queryConfig: QueryConfig<I>): Promise<QueryResult<R>>;
 *   query<R extends QueryResultRow = any, I = any[]>(queryTextOrConfig: string | QueryConfig<I>, values?: QueryConfigValues<I>): Promise<QueryResult<R>>;
 * }} QueryableObject
 */

/** @typedef {QueryableObject | Promise<QueryableObject>} Queryable */

/**
 * @typedef {object} PostgresOptions
 * @property {string} [typesFolder] Path to a folder where all declaration are kept relative to `rootFolder`, i.e. a file at path `src/sql/module.sql` will have its `.d.ts` file generated into `${typesFolder}/src/sql/module.sql.d.ts`. Make sure you include this one in your `tsconfig.json`. Defaults to `"node_modules/@types/vite-plugin-postgres-import/"`.
 * @property {string} [rootFolder] Root folder relative to which path calculation will be happening. Defaults to `process.cwd()`.
 * @property {RuntimeOptions} [runtime] Where the default runtime comes from.
 * @property {boolean | string | ClientConfig} [describe] Type params and result columns by describing every query against a live database, only ever done by the dev server. `true` connects using the `PG*` environment variables, a connection string or `pg` client config may be given instead. Defaults to `false`.
 * @property {Record<string, string | { input?: string, output?: string }>} [typesOverrides] TypeScript types to use for postgres types when `describe` is enabled, keyed by type name (`int8`, `public.mood`, `int8[]`). A string applies to both params (`input`) and columns (`output`).
 */

/**
 * @typedef {object} RuntimeOptions
 * @property {string} [module] Module specifier the default runtime is imported from in every generated module. Defaults to `"#db-runtime"`.
 * @property {string} [export] Named export of `module` providing the default runtime. Defaults to `"db"`.
 * @property {"object" | "function"} [type] Whether the export is a `Queryable` itself or a function returning one (possibly async). Defaults to `"object"`.
 */

/**
 * @param {PostgresOptions} [opts]
 * @returns {Promise<Plugin>}
 */
export default async function postgres(opts = {}) {
	const {
		typesFolder = "node_modules/@types/vite-plugin-postgres-import/",
		rootFolder = process.cwd(),
		runtime: { module: runtimeModule = "#db-runtime", export: runtimeExport = "db", type: runtimeType = "object" } = {},
		describe = false,
		typesOverrides,
	} = opts;
	const runtime = { module: runtimeModule, export: runtimeExport, type: runtimeType };
	const db = describe ? describer(describe, typesOverrides) : undefined;
	let dev = false;
	const imports = await fs
		.readFile(path.join(rootFolder, "package.json"), "utf8")
		.then((s) => JSON.parse(s).imports)
		.catch(() => null);

	const moduleDeclarations = new Map();

	function* targets(/** @type {unknown} */ value) {
		if (typeof value === "string") yield value;
		else if (Array.isArray(value)) for (const v of value) yield* targets(v);
		else if (value) for (const v of Object.values(value)) yield* targets(v);
	}

	function moduleName(/** @type {string} */ filename) {
		const rel = filename.replaceAll(path.sep, "/");
		for (const [key, value] of Object.entries(imports ?? {})) {
			for (let target of targets(value)) {
				target = target.replace(/^\.\//, "");
				const star = target.indexOf("*");
				if (star < 0) {
					if (target === rel) return key;
					continue;
				}
				const prefix = target.substring(0, star);
				const suffix = target.substring(star + 1);
				if (rel.length >= prefix.length + suffix.length && rel.startsWith(prefix) && rel.endsWith(suffix)) {
					return key.replace("*", rel.substring(prefix.length, rel.length - suffix.length));
				}
			}
		}
	}

	return {
		name: "vite-plugin-sql-postgres",
		configResolved(config) {
			dev = config.command === "serve" && config.mode !== "test";
		},
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
		buildEnd() {
			db?.end();
		},
	};

	/** @returns {Promise<TransformResult | undefined>} */
	async function transform(/** @type {string} */ sql, /** @type {string} */ id) {
		if (!/\.sql$/.test(id)) {
			return;
		}
		const filename = path.relative(rootFolder, id);

		const modules = parseModule(sql).toArray();
		if (dev) await db?.annotate(modules, filename);

		const { js, dts, moduleDeclaration, mappings } = codegen(
			modules,
			filename,
			moduleName(filename),
			runtime,
		);

		// described types must not be overwritten by naive ones outside of dev
		if (!db || dev) {
			const dtsFolder = path.join(typesFolder, path.relative(rootFolder, path.dirname(id)));
			const dtsName = path.basename(filename, ".sql") + ".sql.d.ts";
			await fs.mkdir(dtsFolder, { recursive: true });
			await fs.writeFile(path.join(dtsFolder, dtsName), dts + `//# sourceMappingURL=${dtsName}.map\n`);
			await fs.writeFile(
				path.join(dtsFolder, dtsName + ".map"),
				JSON.stringify({
					version: 3,
					file: dtsName,
					sources: [path.relative(dtsFolder, id).replaceAll(path.sep, "/")],
					names: [],
					mappings: encodeMappings([
						{ genLine: 0, genCol: 0, srcLine: 0, srcCol: 0 },
						...exportMappings(dts, mappings),
					]),
				}),
			);
			if (moduleDeclaration.length) {
				moduleDeclarations.set(filename, { text: moduleDeclaration.join("\n"), mappings, id });
				let line = 0;
				const sources = [];
				const combined = [];
				const texts = [];
				for (const { text, mappings, id } of moduleDeclarations.values()) {
					const srcIdx = sources.push(path.relative(typesFolder, id).replaceAll(path.sep, "/")) - 1;
					combined.push({ genLine: line, genCol: 0, srcIdx, srcLine: 0, srcCol: 0 });
					combined.push(...exportMappings(text, mappings, srcIdx, line));
					texts.push(text);
					line += text.split("\n").length;
				}
				await fs.writeFile(
					path.join(typesFolder, "modules.sql.d.ts"),
					texts.join("\n") + "\n//# sourceMappingURL=modules.sql.d.ts.map\n",
				);
				await fs.writeFile(
					path.join(typesFolder, "modules.sql.d.ts.map"),
					JSON.stringify({
						version: 3,
						file: "modules.sql.d.ts",
						sources,
						names: [],
						mappings: encodeMappings(combined),
					}),
				);
			}
		}

		return {
			code: js,
			map: {
				version: 3,
				sources: [id],
				sourcesContent: [sql],
				names: [],
				mappings: encodeMappings([
					{ genLine: 0, genCol: 0, srcLine: 0, srcCol: 0 },
					...exportMappings(js, mappings),
				]),
			},
			moduleType: "js",
		};
	}
}
