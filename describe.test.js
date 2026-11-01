import test from "node:test";
import pg from "pg";
import { describer } from "./describe.js";
import { parseModule } from "./parse.js";

const url = process.env.PG_TEST_URL;
const schema = `vppi_test_${process.pid}`;

const module = `
-- name: GetUser :one
select *, count(*) over () as "total!"
from users
where id = :id! and mood = :mood;

-- name: Broken :one
select nope from users;

-- name: WithPosts :many
select u.name, p.title
from users u
left join posts p on p.user_id = u.id
where u.mail = :mail;

-- name: Rollup :many
select name, count(*) as "n!"
from users
group by rollup(name);

-- name: Insert :one
insert into users (name, mood, mail, moods)
values (:name!, :mood!, :mail!, :moods)
returning id, mail as "mail?";
`;

test("describe", { skip: !url && "PG_TEST_URL is not set" }, async (t) => {
	const setup = new pg.Client(url);
	await setup.connect();
	t.after(async () => {
		await setup.query(`drop schema ${schema} cascade`);
		await setup.end();
	});
	await setup.query(`
		create schema ${schema};
		set search_path = ${schema};
		create type mood as enum ('sad', 'ok', 'happy');
		create domain email as text;
		create table users (
			id int8 generated always as identity primary key,
			name text not null,
			bio text,
			mood mood not null,
			moods mood[],
			mail email not null
		);
		create table posts (id int4 primary key, user_id int8 not null references users, title text not null);
	`);

	const db = describer(
		{ connectionString: url, options: `-c search_path=${schema}` },
		{ int8: "bigint", email: { output: "Email" }, "mood[]": "Mood[]" },
	);
	t.after(() => db.end());

	const warn = t.mock.method(console, "warn", () => {});
	const [getUser, broken, withPosts, rollup, insert] = parseModule(module).toArray();
	await db.annotate([getUser, broken, withPosts, rollup, insert], "test.sql");

	const mood = '"sad" | "ok" | "happy"';
	t.assert.deepEqual(getUser.columns, [
		["id", "bigint"],
		["name", "string"],
		["bio", "string | null"],
		["mood", mood],
		["moods", "Mood[] | null"],
		["mail", "Email"],
		["total", "bigint"],
	]);
	t.assert.deepEqual([...getUser.paramTypes], [["id", "bigint"], ["mood", mood]]);

	t.assert.strictEqual(broken.columns, undefined);
	t.assert.match(warn.mock.calls[0].arguments[0], /Broken: column "nope" does not exist/);

	t.assert.deepEqual(withPosts.columns, [["name", "string | null"], ["title", "string | null"]]);
	t.assert.deepEqual([...withPosts.paramTypes], [["mail", "string"]]);

	t.assert.deepEqual(rollup.columns, [["name", "string | null"], ["n", "bigint"]]);

	t.assert.deepEqual(insert.columns, [["id", "bigint"], ["mail", "Email | null"]]);
	t.assert.deepEqual(
		[...insert.paramTypes],
		[["name", "string"], ["mood", mood], ["mail", "string"], ["moods", "Mood[]"]],
	);
});
