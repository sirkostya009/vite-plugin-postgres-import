import test from "node:test";
import * as unit from "./parse.js";

process.stdout.write("\x1Bc");

const simpleModule = `
-- name: Simple :prepare :one
select 1;
`;

test("test simple module", (t) => {
	try {
		const [parsed] = unit.parseModule(simpleModule).toArray();
		// console.log("parsed simple module", parsed);
		t.assert.strictEqual(parsed.name, "Simple");
		t.assert.strictEqual(parsed.execution, ":one");
		t.assert.strictEqual(parsed.prepared, true);
		t.assert.strictEqual(parsed.query, "select 1");
		// console.log("params", parsed.params, parsed.params.size, parsed.params.size === 0);
		// console.log("selectFields", parsed.selectFields, parsed.selectFields.size);
		// t.assert.strictEqual(parsed.params.size(), 0);
		t.assert.strictEqual(parsed.selectFields.length, 1);
		t.assert.strictEqual(parsed.returningClause.length, 0);
	} catch (err) {
		console.error(err);
		throw err;
	}
});

const multiStatementModule = `
-- name: Multi :one
select 1;

-- :many
select *
from table;
`;

test("test multi-statement module", (t) => {
	const [module] = unit.parseModule(multiStatementModule).toArray();
	// console.log("parsed multi statement module", module);
	t.assert.strictEqual(module.length, 2);
});

const deleteModule = `
-- name: Del :one
delete from table
where name = :name
returning name, timestamp;
`;

test("test delete module", (t) => {
	const [module] = unit.parseModule(deleteModule).toArray();
	// console.log("parsed delete module", module);
	t.assert.deepEqual(module.name, "Del");
});

const multiModule = `
-- name: AnotherDel :one
delete from table
where id = :id
returning id;

-- name: Multi
select statuses.id, status, "\`" as "bigBoy"
from statuses
join joinable on joinable.status_id = id
where joinable.can_join

-- name: Update :many
with updated as (
	update updatable
	set num = 1
	where num <> 1
	returning id
)
select num * random(),
       json_build_object('k', 'v'),
       'value' as alias
from updated;
`;

test("test multi module", (t) => {
	const modules = unit.parseModule(multiModule).toArray();
	// console.log("parsed multi module", modules);
	t.assert.deepEqual(modules.length, 3);
	t.assert.deepEqual(modules[1].selectFields[2], '"bigBoy"');
});

test("test codegen", (t) => {
	const { js, dts } = unit.codegen(unit.parseModule(multiModule), "test.sql", false, "");
	// console.log("codegen js", js);
	// console.log("==========================");
	// console.log("codegen dts", dts);
});

const nonParsableModule = `select 1;`;

test("test non parsable module", (t) => {
	const modules = unit.parseModule(nonParsableModule).toArray();
	// console.log("non parsable module", modules);
	t.assert.deepEqual(modules.length, 0);
});

const realUseCaseTest = `
-- name: InsertMessage :one
insert into account.messages (to_user, from_user, listing_table, listing_id, content)
select :to, :from, tableoid::regclass, :listingId, :content
from account.listing
where id = :listingId
returning messages.id;

-- name: MarkRead :one
update account.messages
set read_at = current_timestamp
where id = :id and read_at is not null and to_user = :to
returning from_user as "from";
`;

test("test real use case", (t) => {
	const { js, dts } = unit.codegen(unit.parseModule(realUseCaseTest), "test.sql", false, "");
	// console.log("codegen js", js);
	// console.log("==========================");
	// console.log("codegen dts", dts);
});

const iterableQuery = `
-- name: AnotherDel :iterable
select *
from t
where stuff = :stuff;
`;

test("test iterable query", (t) => {
	const { js, dts } = unit.codegen(unit.parseModule(iterableQuery), "test.sql", false, "");
	// console.log("codegen js", js);
	// console.log("==========================");
	// console.log("codegen dts", dts);
});

const cursorQuery = `
-- name: AnotherDel :cursor :array
select *
from t;
`;

test("test cursor query", (t) => {
	const { js, dts } = unit.codegen(unit.parseModule(cursorQuery), "test.sql", false, "");
	// console.log("codegen js", js);
	// console.log("==========================");
	// console.log("codegen dts", dts);
});

const requiredParamsQuery = `
-- name: Required :one
select id
from t
where id = :id! and idx = :idx and foo = :foo!= 1;
`;

test("test required params", (t) => {
	const [module] = unit.parseModule(requiredParamsQuery).toArray();
	t.assert.deepEqual([...module.params], ["id", "idx", "foo"]);
	t.assert.deepEqual([...module.required], ["id"]);

	const { js, dts } = unit.codegen([module], "test.sql");
	t.assert.match(js, /where id = \$1 and idx = \$2 and foo = \$3!= 1/);
	t.assert.match(dts, /params: \{ id: \{\}; idx: unknown; foo: unknown \}/);

	module.paramTypes = new Map([["id", "number"], ["idx", "number"], ["foo", "string"]]);
	module.columns = [["id", "number"]];
	t.assert.match(unit.codegen([module], "test.sql").dts, /params: \{ id: number; idx\?: number \| null; foo\?: string \| null \}/);
	module.required.clear();
	t.assert.match(unit.codegen([module], "test.sql").dts, /params\?: \{ id\?: number \| null;/);
	t.assert.match(unit.codegen([module], "test.sql").dts, /R1 extends QueryResultRow = \{ id: number \}/);
});

const hintsQuery = `
-- name: Hints :one
select count(*) as "total!", bio AS "bio?", 'a?"' as quoted
from t;
`;

test("test nullability hints", (t) => {
	const [module] = unit.parseModule(hintsQuery).toArray();
	t.assert.deepEqual([...module.hints], [["total", "!"], ["bio", "?"]]);
	t.assert.deepEqual(module.selectFields.slice(0, 2), ['"total"', '"bio"']);
	t.assert.match(unit.codegen([module], "test.sql").js, /select count\(\*\) as "total", bio AS "bio", 'a\?"' as quoted/);
});

test("test param binding", (t) => {
	t.assert.strictEqual(
		unit.bindParams("a = :id and b = :ID and c = :id! and :pat!~ d and e != :x::int and f = '\\:no'", ["id", "ID", "pat", "x"]),
		"a = $1 and b = $2 and c = $1 and $3!~ d and e != $4::int and f = '\\:no'",
	);
});

const escapingQuery = `
-- name: Escaping :one
select count(*) as "total!"
from t
where name ~ '^\\d+$' and other = '\${x}' and :id::text = \`a\`
order by "total!";
`;

test("test escaping and hint references", async (t) => {
	const [module] = unit.parseModule(escapingQuery).toArray();
	const { js } = unit.codegen([module], "test.sql");
	const text = /text: `([\s\S]*?)`,\n/.exec(js)[1];
	t.assert.strictEqual(
		new Function(`return \`${text}\``)(),
		"select count(*) as \"total\"\nfrom t\nwhere name ~ '^\\d+$' and other = '${x}' and $1::text = `a`\norder by \"total\"",
	);
});

const multiParamsQuery = `
-- name: MultiParams :one
select 1 where :a = 'x';
-- :one
select 2 where :b! = 'y';
`;

test("test multi-statement params", (t) => {
	const [module] = unit.parseModule(multiParamsQuery).toArray();
	t.assert.match(unit.codegen([module], "test.sql").dts, /params: \{ a: unknown; b: \{\} \}/);
	module[0].paramTypes = new Map([["a", "number"]]);
	t.assert.match(unit.codegen([module], "test.sql").dts, /params: \{ a: string; b: string \}/);
});

const slotsQuery = `
-- name: Slotted :many
select * from users where org = :org! and @filter{status?, since!, org} and @other{status, kind?} order by id;

-- name: SlottedMulti :one
select 1 where @w{x};
-- :one
select 2 where :y = 'y';
`;

test("test slots", async (t) => {
	const modules = unit.parseModule(slotsQuery).toArray();
	t.assert.deepEqual(
		[...modules[0].slots].map(([slot, declared]) => [slot, [...declared]]),
		[
			["filter", [["status", "?"], ["since", "!"], ["org", ""]]],
			["other", [["status", ""], ["kind", "?"]]],
		],
	);

	const { js, dts } = unit.codegen(modules, "test.sql");
	t.assert.match(dts, /params: \{ org: \{\}; filter: string; other: string; status: unknown; since: \{\}; kind\?: unknown \}/);

	const calls = [];
	const db = { query: async (q) => (calls.push(q), q.values ? { rows: [] } : [{ rows: [] }, { rows: [] }]) };
	const { slot, slots } = await import("./runtime.js");
	const exports = new Function(
		"__slot",
		"__slots",
		"__runtime",
		"escapeLiteral",
		js.replaceAll(/^import .*$/gm, "").replaceAll("export const ", "const ") + "\nreturn { Slotted, SlottedMulti };",
	)(slot, slots, db, (v) => `'${v}'`);

	await exports.Slotted({ org: 1, filter: "true", other: "x = 1", status: "ok" });
	t.assert.strictEqual(calls[0].text, "select * from users where org = $1 and true and x = 1 order by id");
	t.assert.deepEqual(calls[0].values, [1]);

	await exports.Slotted({
		org: 1,
		filter: "a = :status and b > :since! and c = :org and d::int = :status and e = '\\:no' and :unknown",
		other: "s = :status",
		status: null,
		since: null,
	});
	t.assert.strictEqual(
		calls[1].text,
		"select * from users where org = $1 and a = $2 and b > $3 and c = $1 and d::int = $2 and e = '\\:no' and :unknown and s = $2 order by id",
	);
	t.assert.deepEqual(calls[1].values, [1, null, null]);

	// positions from the previous call must not leak
	await exports.Slotted({ org: 1, filter: "b > :since", other: "s = :status", status: null, since: null });
	t.assert.strictEqual(calls[2].text, "select * from users where org = $1 and b > $2 and s = $3 order by id");
	t.assert.deepEqual(calls[2].values, [1, null, null]);

	await exports.SlottedMulti({ w: "a = :x and b = :y", x: "1", y: "2" });
	t.assert.strictEqual(calls[3].text, "select 1 where a = '1' and b = '2';\n\nselect 2 where '2' = 'y'");
	t.assert.strictEqual(calls[3].values, undefined);
});

test("test slots errors", (t) => {
	t.assert.throws(() => unit.parseModule("-- name: A :one\nselect @x where :x = 1;").toArray(), /shares its name/);
	t.assert.throws(() => unit.codegen(unit.parseModule("-- name: A :one :prepare\nselect @x;"), "test.sql"), /prepared/);
});
