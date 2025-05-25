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

<<<<<<< HEAD
const nonParsableModule = `select 1;`;

test("test non parsable module", (t) => {
	const modules = unit.parseModule(nonParsableModule).toArray();
	// console.log("non parsable module", modules);
	t.assert.deepEqual(modules.length, 0);
});

=======
>>>>>>> 68df3b2 (fixed a whole lotta bugs)
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

<<<<<<< HEAD
=======
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

>>>>>>> 68df3b2 (fixed a whole lotta bugs)
const cursorQuery = `
-- name: AnotherDel :cursor :array
select *
from t;
`;

test("test cursor query", (t) => {
	const { js, dts } = unit.codegen(unit.parseModule(cursorQuery), "test.sql", false, "");
	console.log("codegen js", js);
	console.log("==========================");
	console.log("codegen dts", dts);
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
	console.log("codegen js", js);
	console.log("==========================");
	console.log("codegen dts", dts);
});
