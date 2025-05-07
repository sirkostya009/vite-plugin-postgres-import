import test from "node:test";
import * as unit from "./parse.js";

process.stdout.write("\x1Bc");

const simpleModule = `
-- name: Simple :prepare :one
select 1;
`;

const multiStatementModule = `
-- name: Multi :one
select 1;

-- :many
select *
from table;
`;

const deleteModule = `
-- name: Del :one
delete from table
where name = :name
returning name, timestamp;
`;

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

const nonParsableModule = `select 1;`;

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
		t.assert.strictEqual(parsed.returningClause, undefined);
	} catch (err) {
		console.error(err);
		throw err;
	}
});

test("test multi-statement module", (t) => {
	const [module] = unit.parseModule(multiStatementModule).toArray();
	// console.log("parsed multi statement module", module);
	t.assert.strictEqual(module.length, 2);
});

test("test delete module", (t) => {
	const [module] = unit.parseModule(deleteModule).toArray();
	// console.log("parsed delete module", module);
	t.assert.deepEqual(module.name, "Del");
});

test("test multi module", (t) => {
	const modules = unit.parseModule(multiModule).toArray();
	// console.log("parsed multi module", modules);
	t.assert.deepEqual(modules.length, 3);
});

test("test non parsable module", (t) => {
	const modules = unit.parseModule(nonParsableModule).toArray();
	// console.log("non parsable module", modules);
	t.assert.deepEqual(modules.length, 0);
});

test("test codegen", (t) => {
	const { js, dts } = unit.codegen(unit.parseModule(multiModule), "test.sql", false, "");
	// console.log("codegen js", js);
	// console.log("==========================");
	// console.log("codegen dts", dts);
});
