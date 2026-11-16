import { bindParams, stripHints } from "./parse.js";

/**
 * @import { Client, ClientConfig, FieldDef } from "pg"
 * @import { parseModule } from "./parse.js"
 */

/** @typedef {ReturnType<typeof parseModule> extends Generator<infer T> ? T : never} Module */
/** @typedef {{ params: number[], fields: FieldDef[] }} Description */

// mirrors pg-types' default text parsers, oids absent here come back as strings
/** @type {Record<number, string>} */
const outputTypes = {
	16: "boolean",
	17: "Buffer",
	21: "number",
	23: "number",
	26: "number",
	114: "unknown",
	600: "{ x: number; y: number }",
	700: "number",
	701: "number",
	718: "{ x: number; y: number; radius: number }",
	1082: "Date",
	1114: "Date",
	1184: "Date",
	1186: "Interval",
	3802: "unknown",
};

/** @type {Record<number, string>} */
const inputTypes = {
	16: "boolean",
	17: "Buffer",
	20: "number | bigint | string",
	21: "number",
	23: "number",
	26: "number",
	114: "unknown",
	700: "number",
	701: "number",
	1082: "Date | string",
	1114: "Date | string",
	1184: "Date | string",
	1186: "Interval | string",
	1700: "number | string",
	3802: "unknown",
};

const stringTypes = new Set([18, 19, 20, 25, 142, 650, 790, 829, 869, 1042, 1043, 1083, 1266, 1560, 1562, 1700, 2950]);

// array oid -> element oid, only for arrays pg-types parses, the rest come back as raw strings
/** @type {Record<number, number>} */
const arrays = {
	199: 114,
	651: 650,
	791: 790,
	1000: 16,
	1001: 17,
	1005: 21,
	1007: 23,
	1008: 24,
	1009: 25,
	1014: 1042,
	1015: 1043,
	1016: 20,
	1017: 600,
	1021: 700,
	1022: 701,
	1028: 26,
	1040: 829,
	1041: 869,
	1115: 1114,
	1182: 1082,
	1183: 1083,
	1185: 1184,
	1187: 1186,
	1231: 1700,
	1270: 1266,
	2951: 2950,
	3807: 3802,
	3907: 3906,
};

const catalogQuery = `select
	(select coalesce(json_agg(json_build_array(
		t.oid::int8,
		case when t.typcategory = 'A' then t.typelem::int8 else 0 end,
		case when t.typtype = 'd' then t.typbasetype::int8 else 0 end,
		n.nspname,
		t.typname,
		(select json_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid)
	)), '[]')
	from pg_type t
	join pg_namespace n on n.oid = t.typnamespace
	where t.oid = any($1::oid[])
		or t.oid in (select case when typcategory = 'A' then typelem else typbasetype end from pg_type where oid = any($1::oid[]))) as types,
	(select coalesce(json_agg(json_build_array(
		a.attrelid::int8,
		a.attnum,
		a.attnotnull,
		case when t.typtype = 'd' then json_build_array(n.nspname, t.typname) end
	)), '[]')
	from unnest($2::oid[], $3::int2[]) c(rel, num)
	join pg_attribute a on a.attrelid = c.rel and a.attnum = c.num
	join pg_type t on t.oid = a.atttypid
	join pg_namespace n on n.oid = t.typnamespace) as columns`;

// both null out columns of otherwise not null table columns
const nullifying = /\b(left|right|full)\s+(outer\s+)?join\b|\b(rollup|cube|grouping\s+sets)\s*\(/i;

/** Parses and describes statements without executing them, the way psql's \gdesc does. */
class Describe {
	/** @param {string[]} texts */
	constructor(texts) {
		this.texts = texts;
		/** @type {Description[]} */
		this.results = [];
		/** @type {Promise<{ results: Description[], error?: Error }>} */
		this.promise = new Promise((resolve) => (this.resolve = resolve));
		/** @type {import("events").EventEmitter | undefined} */
		this.connection = undefined;
		this.onParams = (/** @type {{ dataTypeIDs: number[] }} */ msg) =>
			// pg-protocol reads these as signed int32, unlike row description oids
			this.results.push({ params: msg.dataTypeIDs.map((oid) => oid >>> 0), fields: [] });
	}

	/** @param {any} connection */
	submit(connection) {
		this.connection = connection;
		connection.on("parameterDescription", this.onParams);
		for (const text of this.texts) {
			connection.parse({ text });
			connection.describe({ type: "S" });
		}
		connection.sync();
	}

	/** @param {{ fields: FieldDef[] }} msg */
	handleRowDescription(msg) {
		this.results[this.results.length - 1].fields = msg.fields;
	}

	handleReadyForQuery() {
		this.done();
	}

	/** @param {Error} error */
	handleError(error) {
		this.done(error);
	}

	/** @param {Error} [error] */
	done(error) {
		this.connection?.off("parameterDescription", this.onParams);
		this.resolve?.({ results: this.results, error });
	}
}

/**
 * @param {true | string | ClientConfig} config
 * @param {Record<string, string | { input?: string, output?: string }>} [typesOverrides]
 */
export function describer(config, typesOverrides = {}) {
	const overrides = new Map(
		Object.entries(typesOverrides).map(([k, v]) => [k, typeof v === "string" ? { input: v, output: v } : v]),
	);

	/** @type {Promise<{ client: Client, DatabaseError: Function }> | undefined} */
	let connection;
	/** @type {Promise<unknown>} */
	let tail = Promise.resolve();

	/**
	 * pg no longer allows queueing queries on a client, so concurrent transforms take turns.
	 * @template T
	 * @param {() => Promise<T>} fn
	 */
	function exclusive(fn) {
		const run = tail.then(fn);
		tail = run.catch(() => {});
		return run;
	}

	/** @type {WeakSet<object>} */
	const reported = new WeakSet();

	function connect() {
		if (connection) return connection;
		const pending = (connection = import("pg").then(async ({ default: pg }) => {
			const client = new pg.Client({
				connectionTimeoutMillis: 5000,
				...(config === true ? {} : typeof config === "string" ? { connectionString: config } : config),
			});
			client.on("error", (err) => {
				console.warn(`[postgres] connection error: ${err.message}`);
				if (connection === pending) connection = undefined;
			});
			await client.connect();
			return { client, DatabaseError: pg.DatabaseError };
		}));
		// fail fast for a while, instead of every file waiting out the timeout again
		pending.catch(() =>
			setTimeout(() => {
				if (connection === pending) connection = undefined;
			}, 10_000).unref(),
		);
		return pending;
	}

	/**
	 * Pipelines every statement in a single round trip, re-sending the ones following a failed statement.
	 * @param {string[]} texts
	 * @returns {Promise<(Description | { error: Error })[]>}
	 */
	async function describe(texts) {
		const { client, DatabaseError } = await connect();
		/** @type {(Description | { error: Error })[]} */
		const out = [];
		while (out.length < texts.length) {
			const query = new Describe(texts.slice(out.length));
			client.query(/** @type {any} */ (query));
			const { results, error } = await query.promise;
			out.push(...results);
			if (!error) break;
			if (!(error instanceof DatabaseError)) throw error;
			out.push({ error });
		}
		return out;
	}

	return {
		/**
		 * Sets `columns` and `paramTypes` on each statement from what the database reports.
		 * @param {(Module | Module[])[]} modules
		 * @param {string} filename
		 */
		async annotate(modules, filename) {
			// slots' sql is only known at runtime
			const statements = modules.flat().filter((s) => !s.slots.size);
			if (!statements.length) return;
			const texts = statements.map((s) => bindParams(stripHints(s.query), s.params));

			/** @type {Map<number, { elem: number, base: number, name: [schema: string, name: string], labels: string[] | null }>} */
			const catalog = new Map();
			/** @type {Map<string, { notnull: boolean, domain: [schema: string, name: string] | null }>} */
			const columns = new Map();
			/** @type {Awaited<ReturnType<typeof describe>>} */
			let described = [];
			try {
				await exclusive(async () => {
					described = await describe(texts);

					/** @type {Set<number>} */
					const lookup = new Set();
					const rels = [];
					const nums = [];
					for (const d of described) {
						if (!("params" in d)) continue;
						for (const oid of [...d.params, ...d.fields.map((f) => f.dataTypeID)]) {
							if (overrides.size || !(oid in outputTypes || oid in inputTypes || oid in arrays || stringTypes.has(oid))) {
								lookup.add(oid);
							}
						}
						for (const f of d.fields) {
							if (f.tableID) {
								rels.push(f.tableID);
								nums.push(f.columnID);
							}
						}
					}
					if (lookup.size || rels.length) {
						const { client } = await connect();
						const { rows } = await client.query(catalogQuery, [[...lookup], rels, nums]);
						for (const [oid, elem, base, schema, name, labels] of rows[0].types) {
							catalog.set(oid, { elem, base, name: [schema, name], labels });
						}
						for (const [rel, num, notnull, domain] of rows[0].columns) columns.set(`${rel}.${num}`, { notnull, domain });
					}
				});
			} catch (err) {
				if (!reported.has(/** @type {Error} */ (err))) {
					reported.add(/** @type {Error} */ (err));
					console.warn(`[postgres] could not describe ${filename}: ${/** @type {Error} */ (err).message}`);
				}
				return;
			}

			const labels = (/** @type {number} */ oid) => catalog.get(oid)?.labels?.map((l) => JSON.stringify(l)).join(" | ");

			/** @returns {[schema: string, name: string] | undefined} */
			const typeName = (/** @type {number} */ oid) => {
				const t = catalog.get(oid);
				if (!t?.elem) return t?.name;
				const elem = catalog.get(t.elem)?.name;
				return elem && [elem[0], `${elem[1]}[]`];
			};

			const override = (/** @type {[string, string] | null | undefined} */ type, /** @type {"input" | "output"} */ side) =>
				type && (overrides.get(`${type[0]}.${type[1]}`) ?? overrides.get(type[1]))?.[side];

			// pg parses arrays separately from their elements, so element overrides don't apply to them
			/** @returns {string} */
			const baseOutput = (/** @type {number} */ oid) =>
				outputTypes[oid] ??
				(oid in arrays ? `${wrap(oid === 1231 ? "number" : baseOutput(arrays[oid]))}[]` : labels(oid) ?? "string");

			const output = (/** @type {number} */ oid) => override(typeName(oid), "output") ?? baseOutput(oid);

			/** @returns {string} */
			const input = (/** @type {number} */ oid) => {
				const type = override(typeName(oid), "input") ?? inputTypes[oid];
				if (type) return type;
				const t = catalog.get(oid);
				const elem = arrays[oid] ?? t?.elem;
				if (elem) return `${wrap(input(elem))}[]`;
				if (t?.base) return input(t.base);
				return labels(oid) ?? (oid ? "string" : "unknown");
			};

			for (let i = 0; i < statements.length; ++i) {
				const s = statements[i];
				const d = described[i];
				if ("error" in d) {
					console.warn(`[postgres] ${filename}: ${s.name}: ${d.error.message}`);
					continue;
				}
				const nullified = nullifying.test(s.query);
				s.columns = d.fields.map((f) => {
					const column = columns.get(`${f.tableID}.${f.columnID}`);
					const type = override(column?.domain, "output") ?? output(f.dataTypeID);
					const hint = s.hints.get(f.name);
					const nullable = hint ? hint === "?" : nullified || !column?.notnull;
					return [
						/^[A-Za-z_$][\w$]*$/.test(f.name) ? f.name : JSON.stringify(f.name),
						type === "unknown" || !nullable ? type : `${type} | null`,
					];
				});
				s.paramTypes = new Map(s.params.values().map((p, j) => [p, input(d.params[j])]));
			}
		},

		end() {
			const pending = connection;
			connection = undefined;
			pending?.then(({ client }) => client.end()).catch(() => {});
		},
	};
}

function wrap(/** @type {string} */ type) {
	return type.includes("|") ? `(${type})` : type;
}
