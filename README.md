# vite-plugin-postgres-import

Ever wanted to ditch those ORMs and finally learn SQL?

If you use PostgreSQL and Vite - this plugin is right for you!

Start importing `.sql` files with sqlc-style annotations right into your JavaScript code today!

## Usage

`module.sql`:

```sql
-- name: Query :one
select id
from t
where id = :id;

-- name: UpdateQuery :execrows
update t
set foo = :newFoo
where id = :id;

-- name: QueryMany :many
select *
from t;

-- name: MultiStatement :many
select *
from t;
-- :one
select something
from t
limit 1;
-- :execrows
delete from t
where foo = :foo;
```

`db-runtime.js` (the default runtime, should be mapped to `#db-runtime` via [subpath imports](https://nodejs.org/api/packages.html#subpath-imports)):

```js
import { Pool } from "pg";

export const db = new Pool("...");
```

`usage.js`:

```js
import { Query, UpdateQuery, QueryMany, MultiStatement } from "./module.sql";

const { id } = await Query({ id: 1 });

const rowsUpdated = await UpdateQuery({ id: 1, newFoo: "bar" });

const array = await QueryMany();

// array, object, number respectively
const [all, something, deleted] = await MultiStatement({ foo: "bar" });

// override the runtime per call, e.g. to run inside a transaction
const rowsUpdated = await UpdateQuery({ id: 1, newFoo: "baz" }, { db: tx });
```

> [!Warning]
>
> Postgres does _NOT_ allow using parameters in multi-statement queries.
>
> The current implementation for them is a hackaround that involes injecting escaped values into the SQL string.

## Annotations

The only 4 sqlc annotations that are available are the following:

-   `:execresult` - default if neither of the 3 below are provided, returns `QueryResult`.

    ex.: `Query<R extends QueryResultRow = { ... }>(params?, config?): Promise<QueryResult<R>>`

-   `:one` - returns template argument, or the default-parsed ones from the select/returning clause.

    ex.: `Query<R extends QueryResultRow = { ... }>(params?, config?): Promise<R>`

-   `:many` - returns template argument as an array, or the default-parsed ones from the select/returning clause.

    ex.: `Query<R extends QueryResultRow = { ... }>(params?, config?): Promise<R[]>`

-   `:execrows` - returns number of affected rows.

    ex.: `Query(params?, config?): Promise<number>`

4 additional annotations not found in sqlc are available:

-   `:prepare` - prepares the statement by passing query's name to query config.

> [!Warning]
>
> Similarly to parameters, Postgres does _NOT_ allow preparing multi-statement queries. Using `:prepare` on a multi-statement query will result in an error. I warned you!

> [!Warning]
>
> Don't use identical names for prepared queries, regardless whether they're in different `.sql` modules or not:
>
> `one.sql`:
>
> ```sql
> -- name: One :one :prepare
> select *
> from t
> ```
>
> `another-one.sql`:
>
> ```sql
> -- name: One :one :prepare
> select id
> from t
> where id = :id;
> ```
>
> `script.js`:
>
> ```js
> import { One } from "./one.sql";
> import { One as AnotherOne } from "./another-one.sql";
>
> // definitely don't do this
> await One();
> await AnotherOne({ id: ... });
> ```
>
> At best, you'd get an error in the provided example, due to mismatch in provided values, and at worst, assuming different examples, you'd be getting obscure bugs related to incorrect data.

-   `:array` - sets `rowMode` to `'array'`. Modifies to type declarations accordingly:

    ex. `:execresult`: `Query<R extends any[] = [ ... ]>(params?, config?): Promise<QueryArrayResult<R>>`

    ex. `:one`: `Query<R extends any[] = [ ... ]>(params?, config?): Promise<R>`

    ex. `:many`: `Query<R extends any[] = [ ... ]>(params?, config?): Promise<R[]>`

-   `:iterable` - returns an `AsyncGenerator`. Once [Async Iterator Helpers](https://github.com/tc39/proposal-async-iterator-helpers)
    are in the standard, you can use crazy piping as following:

```js
const result = await IterableQuery<{ ... }>({ foo: 'bar' })
    .flatMap(superComplicatedCodeThatIsMoreUsefulToRunFromJS)
    .filter(Boolean)
    .toArray();
```

Well maybe that didn't look too crazy, but if some filtering forces your squeel to become convoluted, and you're fine with moving
some of that computation to JS, you can finally do that! Or at least when that proposal is in the language, that is.

-   `:cursor` - returns an `Cursor`

ex.: `Query<R extends QueryResultRow = { ... }>(params?, config?): Promise<Cursor<R>>`

    ex. `:array`: `Query<R extends any[] = [ ... ]>(params?, config?): Promise<Cursor<R>>`

## Configuring

### `typesFolder`

Path to a folder where all declaration are kept relative to `rootFolder`, i.e.
a file at path `src/sql/module.sql` will have its `.d.ts` file generated into `${typesFolder}/src/sql/module.sql.d.ts`.
Make sure you include this one in your tsconfig's `rootDirs` array as `"${typesFolder}/**/*.sql.d.ts"`.

_default:_ `'node_modules/@types/vite-plugin-postgres-import/'`

### `rootFolder`

Root folder relative to which path calculation will be happening. May be useful for some I guess.

_default:_ `process.cwd()`

### `runtime`

Where the default runtime comes from:

-   `module` - specifier every generated module imports the runtime from. Point it at a module of yours
    (typically via a subpath import) that provides the database connection. _default:_ `'#db-runtime'`
-   `export` - named export of `module` holding the runtime. _default:_ `'db'`
-   `type` - either `'object'` — the export is a `Queryable` (or a promise of one) — or `'function'` — the export
    is called on each query invocation and returns a `Queryable` (or a promise of one). _default:_ `'object'`

## Import aliases

If your `package.json` declares [subpath imports](https://nodejs.org/api/packages.html#subpath-imports),
matching `.sql` files get ambient module declarations generated for their aliased paths:

```json
{
	"imports": {
		"#sql/*": "./src/sql/*"
	}
}
```

With that, `import { Query } from "#sql/module.sql"` is fully typed — declarations land in `${typesFolder}/modules.sql.d.ts`.
Exact and conditional (`{ "node": ..., "default": ... }`) targets are supported too.

## Transactions

With the `'function'` runtime type, the runtime is re-evaluated on every query call — which means it can
consult [`AsyncLocalStorage`](https://nodejs.org/api/async_context.html#class-asynclocalstorage) and pick up
an _ambient_ transaction: queries anywhere down the call stack automatically run on the transaction's client,
no threading of `{ db }` through your functions. Combined with
[explicit resource management](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/await_using)
you get commit-explicitly, rollback-on-dispose semantics without any callback wrapping.

`vite.config.js`:

```js
postgres({ runtime: { type: "function" } });
```

`db-runtime.js`:

```js
import { AsyncLocalStorage } from "node:async_hooks";
import { Pool } from "pg";

const pool = new Pool("...");
export const als = new AsyncLocalStorage();

export const db = () => als.getStore()?.current ?? pool;

let spSeq = 0;

// pushes a new transaction on the frame,
// nested calls result in savepoints.
export async function transaction(begin = "begin") {
	const frame = als.getStore();

	if (frame.current) {
		// already inside a transaction - nest via a savepoint on the same client
		const client = frame.current;
		const name = `sp_${++spSeq}`;
		await client.query(`savepoint ${name}`);
		let done = false;
		const finish = async (q) => {
			done = true;
			await client.query(q);
		};
		return {
			db: client,
			commit: () => finish(`release savepoint ${name}`),
			rollback: () => finish(`rollback to savepoint ${name}`),
			async [Symbol.asyncDispose]() {
				if (!done) await finish(`rollback to savepoint ${name}`);
			},
		};
	}

	const client = await pool.connect();
	await client.query(begin);
	frame.current = client;
	let done = false;
	const finish = async (q) => {
		done = true;
		frame.current = undefined;
		try {
			await client.query(q);
		} finally {
			client.release();
		}
	};
	return {
		db: client,
		commit: () => finish("commit"),
		rollback: () => finish("rollback"),
		async [Symbol.asyncDispose]() {
			if (!done) await finish("rollback");
		},
	};
}
```

```js
import { transaction } from "#db-runtime";

await using tx = await transaction();
await UpdateQuery({ id: 1, newFoo: "bar" });
await InsertAudit({ id: 1 }); // same transaction, however deep the call stack
await tx.commit(); // anything thrown before this point rolls back on scope exit
```

## Jump to source

Generated `.d.ts` files ship with declaration maps pointing back at the original `.sql` file,
so "Go to Definition" / "Go to Source Definition" on an imported function (or the import path itself) lands you
on the query source itself. The vite transform also emits a sourcemap, so runtime stack traces
and debugger stepping map back to the `.sql` source.

## What this plugin does NOT do

This plugin does not connect to the database or scan a schema folder, instead naively
parsing select or returning clauses to figure out potential response types.

## License

MIT.
