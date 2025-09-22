const annotationRegex = /--\s*name:\s*(?<name>[a-zA-Z][\w_]*)\s*(?<tags>(:\w+\s*)*)?\r?\n/g;

const partial = Symbol();

export function* parseModule(/** @type {string} */ sql) {
	annotationRegex.lastIndex = 0;

	/** @type {RegExpMatchArray[]} */
	const matches = sql.matchAll(annotationRegex).toArray();

	for (let i = 0; i < matches.length; ++i) {
		const rema = matches[i];
		const [first, ...rest] = sql
			.substring(rema.index, i + 1 < matches.length ? matches[i + 1].index : sql.length)
			.split(/;\s*$/m)
			.map((s) => s.trim())
			.filter(Boolean);
		if (rest.length > 0) {
			const firstMeta = metadata(first);
			yield [firstMeta, ...rest.map((r) => metadata(r, firstMeta))];
		} else {
			yield metadata(first);
		}
	}
}

function metadata(/** @type {string} */ s, /** @type {ReturnType<typeof metadata>} */ firstMeta = undefined) {
	annotationRegex.lastIndex = 0;
	const match = firstMeta ? /--\s*(?<tags>(:\w+\s*)*)\r?\n/.exec(s) : annotationRegex.exec(s);
	const meta = match?.groups;
	const query = s.substring(match?.[0]?.length ?? 0).trim();

	return {
		name: firstMeta?.name || meta?.name,
		execution: /:one|:many|:execrows/.exec(meta?.tags)?.[0] || ":execresult",
		prepared: meta?.tags?.includes(":prepare"),
		mode: /:cursor|:iterable/.exec(meta?.tags)?.[0],
		rowArray: meta?.tags?.includes(":array"),
		query,
		params: new Set(query.matchAll(/(?<![\w_\\:]):[\w_]+/g).map((m) => m?.[0]?.substring(1))),
		selectFields: selectList(/(with.*\))?\s*select\s+(?<select>.*)/ims.exec(query)?.groups?.select)
			.map(parseResultSymbol)
			.toArray(),
		returningClause: selectList(/returning\s+(?<returning>[\w\s\.\",\*]+);?$/im.exec(query)?.groups?.returning)
			.map(parseResultSymbol)
			.toArray(),
	};

	function parseResultSymbol(/** @type {string} */ s) {
		s = s.trim();
		while (s.startsWith("(") && s.endsWith(")")) {
			// unwrap
			s = s.substring(1, s.length - 1).trim();
		}
		const gotDatAs = /as ([_\w"]+)$/i.exec(s)?.[1];
		if (gotDatAs) return gotDatAs.endsWith('"') && gotDatAs.includes(" ") ? `'${gotDatAs}'` : gotDatAs;
		const uncCall = /^([\w_]+)[\(\[].*[\)\]]$/.exec(s)?.[1];
		if (uncCall) return uncCall;
		const subselect = /^select\s+([\w_]+)[,]?.*$/i.exec(s)?.[1];
		if (subselect) return subselect;
		const word = /(^|\.)[a-zA-Z]+$/.exec(s)?.[0];
		if (word) return word[0] === "." ? word.substring(1) : word;
		const star = /^\*$/.exec(s)?.[0];
		if (star) return "[column: string]";
		return '"?column?"'; // ???
	}

	function* selectList(/** @type {string=} */ select) {
		if (!select) return;
		let index = 0;
		let nestingLevel = 0;
		let inString = null;
		for (const token of select.matchAll(/([:\w_]+)|[\(\)'("")]|[,]|\*/g)) {
			if (token[0] === inString) inString = null;
			else if (token[0] === "'" || token[0] === "$$" || token[0] === '"') inString = token[0];
			if (token[0] === ")") nestingLevel--;
			else if (token[0] === "(") nestingLevel++;
			else if (token[0] === "," && nestingLevel === 0 && !inString) {
				yield select.substring(index, token.index + token[0].length - 1);
				index = token.index + token[0].length + 1;
			} else if (token[0] === "from" && nestingLevel === 0 && !inString) {
				yield select.substring(index, token.index);
				return;
			}
		}
		yield select.substring(index);
	}
}

export function codegen(
	/** @type {Iterable<ReturnType<typeof metadata> | ReturnType<typeof metadata>[]>} */ modules,
	/** @type {string} */ filename,
	/** @type {Awaited<ReturnType<typeof parseLocalSvelteConfigAliases>>} */ aliases
) {
	let dts = [
		// `declare module '${modulePrefix}${filename}.sql' {`
		`import type { QueryResultRow, QueryResult, QueryArrayResult } from 'pg';\nimport { Queryable } from 'vite-plugin-postgres-import';`,
	];
	let js = [`import { escapeLiteral } from 'pg';`];

	for (let module of modules) {
		module = Array.isArray(module)
			? {
					...module[0],
					query: module.flatMap((m) => m.query).join(";\n\n"),
					params: new Set(module.flatMap((m) => [...m.params])),
					execution: module.map((m) => m.execution),
					returnSymbols: module.map((m) => (m.returningClause?.length ? m.returningClause : m.selectFields)),
					multiStatement: true,
			  }
			: {
					...module,
					execution: [module.execution],
					returnSymbols: [module.returningClause?.length ? module.returningClause : module.selectFields],
					multiStatement: "",
			  };

		if (!module.rowArray) {
			module.returnSymbols = module.returnSymbols.map((rs) => [...new Set(rs)]);
		}

		if (module.mode) {
			dts[0] += `\nimport Cursor from 'pg-cursor';`;
			js.push(`import Cursor from 'pg-cursor';`);
		}

		const keys = module.params
			.values()
			.map((k) => `'${k}'`)
			.toArray()
			.join(" | ");

		dts.push(`/**
 * ${"```"}sql
${module.query}
 * ${"```"}
 */
export function ${module.name}<${module.returnSymbols
			.map((r, i) =>
				module.rowArray
					? `R${i + 1} extends any[] = ${
							r.find((k) => k.startsWith("[column: string]"))
								? `unknown[]`
								: `[ ${r?.map(() => `unknown`)?.join(", ") ?? ""} ]`
					  }`
					: `R${i + 1} extends QueryResultRow = {${r.length > 3 ? "\n\t" : " "}${
							r?.map((r) => `${r}: unknown`)?.join(r.length > 3 ? ";\n\t" : "; ") ?? ""
					  }${r.length > 3 ? "\n" : " "}}`
			)
			.join(", ")}>(
	tx: Queryable,${keys && `\n\tparams: Record<${keys}, unknown>,`}${
			module.mode === ":iterable" ? `\n\tread?: number,` : ""
		}
): ${
			module.mode === ":cursor"
				? `Cursor<R1>`
				: module.mode === ":iterable"
				? `AsyncGenerator<R1, void, unknown>`
				: `Promise<${module.multiStatement && "["}${module.returnSymbols
						.map((_, i) =>
							module.execution[i] === ":execresult"
								? `Query${module.rowArray ? "Array" : ""}Result<R${i + 1}>`
								: module.execution[i] === ":one"
								? `R${i + 1}`
								: module.execution[i] === ":many"
								? `R${i + 1}[]`
								: module.execution[i] === ":execrows"
								? `number`
								: "unknown"
						)
						.join(", ")}${module.multiStatement && "]"}>`
		};`);

		const paramsString = module.params
			.values()
			.reduce((curr, p) => [...curr, p], [])
			.join();

		module.query = module.query.replaceAll("`", "\\`");

		module.params.values().forEach(
			(param, i) =>
				(module.query = module.query.replaceAll(
					new RegExp(`(?<![\w_]):${param}(?![\w_])`, "gi"),
					module.multiStatement ? `\${escapeLiteral(${param})}` : `$${i + 1}` // the escapists
				))
		);

		if (module.prepared && module.execution.size > 1) {
			console.warn(
				"Postgres does not support preparing multi-statement queries. You will get an error, just sayin'"
			);
		}

		js.push(
			module.mode === ":cursor"
				? `export const ${module.name} = async (tx${
						paramsString && `, { ${paramsString} } = {}`
				  }) => (await tx).query(new Cursor(\`${module.query}\`${paramsString && `, [ ${paramsString} ]`}${
						module.rowArray ? `, { rowMode: "array" }` : ""
				  }));`
				: module.mode === ":iterable"
				? `export async function* ${module.name}(tx, ${paramsString && `{ ${paramsString} } = {}, `}read = 10) {
	const cursor = (await tx).query(new Cursor(\`${module.query}\`${paramsString && `, [ ${paramsString} ]`}${
						module.rowArray ? `, { rowMode: "array" }` : ""
				  }));
	try {
		let _read;
		do {
			_read = await cursor.read(read);
			yield* _read;
		} while (_read.length === read);
	} finally {
		await cursor.close();
	}
}`
				: `export const ${module.name} = async (tx, { ${paramsString} } = {}) => (await tx).query({
	${module.prepared ? `name: "${module.name}",` : ""}
	text: \`${module.multiStatement ? module.query : module.query}\`,
	values: [ ${module.multiStatement || paramsString} ],
	${module.rowArray ? `rowMode: "array",` : ""}
}).then((${module.multiStatement && "["}${module.returnSymbols.map((_, i) => `r${i + 1}`).join()}${
						module.multiStatement && "]"
				  }) => ${module.multiStatement && "["}${module.returnSymbols
						.map(
							(_, i) =>
								`r${i + 1}` +
								(module.execution[i] === ":one"
									? `.rows[0]`
									: module.execution[i] === ":many"
									? `.rows`
									: module.execution[i] === ":execrows"
									? `.rowCount`
									: "")
						)
						.join()}${module.multiStatement && "]"});`
		);
	}

	const match = aliases[filename] ?? aliases[partial].find(({ path }) => filename.startsWith(path));
	let moduleDeclaration = [];
	if (match) {
		const mod = "path" in match ? match.alias + filename.replace(match.path, "") : match.alias;
		moduleDeclaration.push(`declare module "${mod}" {`, dts[0], ...dts.slice(1), `}`);
	}

	return { js: js.join("\n"), dts: dts.join("\n\n") + "\n", moduleDeclaration };
}

/** @returns {Promise<{ [partial]: { path: string; alias: string; }[]; [k: string]: { alias: string } }>} */
export async function parseLocalSvelteConfigAliases() {
	/** @type {{ default: import('@sveltejs/kit').Config }} */
	const { default: svelteConfig } = await import(process.cwd() + "/svelte.config.js").catch(() => ({
		default: {},
	}));

	const aliases = svelteConfig.kit?.alias ?? {};

	return Object.entries(aliases).reduce(
		(acc, [alias, path]) => {
			if (path.endsWith(".sql")) {
				acc[path] = { alias };
			} else {
				if (path.endsWith("/*")) {
					path = path.substring(0, path.length - 1);
					alias = alias.substring(0, alias.length - 1);
				}
				acc[partial].push({ path, alias });
			}
			return acc;
		},
		{ [partial]: [] }
	);
}
