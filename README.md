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

`usage.js`:

```js
import { Pool } from "pg";
import { Query, UpdateQuery, QueryMany, MultiStatement } from "./module.sql";

const pool = new Pool("...");

const { id } = await Query(pool, { id: 1 });

const rowsUpdated = await UpdateQuery(pool, { id: 1, newFoo: "bar" });

const array = await QueryMany(pool);

// array, object, number respectively
const [all, something, deleted] = await MultiStatement(pool, { foo: "bar" });
```

> [!Warning]
>
> Postgres does _NOT_ allow using parameters in multi-statement queries.
>
> The current implementation for them is a hackaround that involes injecting escaped values into the SQL string.

## Annotations

The only 4 sqlc annotations that are available are the following:

-   `:execresult` - default if neither of the 3 below are provided, returns `QueryResult`.

    ex.: `Query<R extends QueryResultRow = { ... }>(c): Promise<QueryResult<R>>`

-   `:one` - returns template argument, or the default-parsed ones from the select/returning clause.

    ex.: `Query<R extends QueryResultRow = { ... }>(c): Promise<R>`

-   `:many` - returns template argument as an array, or the default-parsed ones from the select/returning clause.

    ex.: `Query<R extends QueryResultRow = { ... }>(c): Promise<R[]>`

-   `:execrows` - returns number of affected rows.

    ex.: `Query(c): Promise<number>`

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
> await One(c);
> await AnotherOne(c, { id: ... });
> ```
>
> At best, you'd get an error in the provided example, due to mismatch in provided values, and at worst, assuming different examples, you'd be getting obscure bugs related to incorrect data.

-   `:array` - sets `rowMode` to `'array'`. Modifies to type declarations accordingly:

    ex. `:execresult`: `Query<R extends any[] = [ ... ]>(c): Promise<QueryArrayResult<R>>`

    ex. `:one`: `Query<R = [ ... ]>(c): Promise<R>`

    ex. `:many`: `Query<R = [ ... ]>(c): Promise<R[]>`

-   `:iterable` - returns an `AsyncGenerator`. Once [Async Iterator Helpers](https://github.com/tc39/proposal-async-iterator-helpers)
    are in the standard, you can use crazy piping like following:

```js
const result = await IterableQuery<{ ... }>(c, { foo: 'bar' })
    .flatMap(superComplicatedCodeThatIsMoreUsefulToRunFromJS)
    .filter(Boolean)
    .toArray();
```

-   `:cursor` - returns an `Cursor`

    ex.:

## Configuring

### `typesFolder`

Path to a folder where all declaration are kept relative to `rootFolder`, i.e.
a file at path `src/sql/module.sql` will have its `.d.ts` file generated into `${typesFolder}/src/sql/module.sql.d.ts`.
Make sure you include this one in your `tsconfig.json` as `"${typesFolder}/**/*.sql.d.ts"`.

_default:_ `'node_modules/@types/vite-plugin-postgres-import/'`

### `modulePrefix`

**CURRENTLY DISABLED**. This one changes the type declaration generation strategy to generate everything as `declare module` statements.

### `rootFolder`

Root folder relative to which path calculation will be happening. May be useful for some I guess.

_default:_ `process.cwd()`

## What this plugin does NOT do

This plugin does not connect to the database or scan a schema folder, instead naively
parsing select or returning clauses to figure out potential response types.

In a real TypeScript project you should probably still roll your own types?

And JavaScript projects still get the benefits of completions.

## SvelteKit use case

I primarily use this in a SvelteKit project. The only thing I modify is setting `typesFolder` to `'.svelte-kit/types'` directory, and adding a `".svelte-kit/types/**/*.sql.d.ts"` record to my `include` array in `tsconfig.json`.

## License

MIT.
