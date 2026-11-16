import test from "node:test";
import { slot, slots } from "./runtime.js";

test("slots state", (t) => {
	const q = slots(["a", "b"], ["c", "a", "d"]);
	t.assert.deepEqual([...q.index], [["a", 1], ["b", 2], ["c", ~0], ["d", ~2]]);
	t.assert.strictEqual(q.k, 2);
	t.assert.deepEqual(q.ph, ["$1", "$2", "$3", "$4", "$5"]);
	t.assert.strictEqual(q.pos.length, 3);
	t.assert.strictEqual(q.mark.length, 3);
	t.assert.strictEqual(q.esc, undefined);
});

test("slot without params is returned as is", (t) => {
	const s = "status = 'ok'";
	const values = [1];
	t.assert.strictEqual(slot(s, values, {}, slots(["a"], ["b"])), s);
	t.assert.deepEqual(values, [1]);
});

test("slot binds own params to their positions", (t) => {
	const values = [1, 2];
	t.assert.strictEqual(slot(":b = :a and :a", values, {}, slots(["a", "b"], [])), "$2 = $1 and $1");
	t.assert.deepEqual(values, [1, 2]);
});

test("slot appends slot params on first use", (t) => {
	const q = slots(["a"], ["x", "y"]);
	const values = [1];
	t.assert.strictEqual(slot(":y and :x and :y and :a", values, { x: "x", y: "y" }, q), "$2 and $3 and $2 and $1");
	t.assert.deepEqual(values, [1, "y", "x"]);
});

test("slot positions are shared between slots of a call", (t) => {
	const q = slots([], ["x", "y"]);
	const values = [];
	const params = { x: 1, y: 2 };
	t.assert.strictEqual(slot(":x", values, params, q), "$1");
	t.assert.strictEqual(slot(":y and :x", values, params, q), "$2 and $1");
	t.assert.deepEqual(values, [1, 2]);
});

test("slot positions don't leak between calls", (t) => {
	const q = slots(["a"], ["x", "y"]);
	const params = { a: 0, x: null, y: null };

	const first = [0];
	t.assert.strictEqual(slot(":x and :y", first, params, q), "$2 and $3");

	// $2 is taken by y now, x must not reuse it despite equal values
	const second = [0];
	t.assert.strictEqual(slot(":y and :x", second, params, q), "$2 and $3");
	t.assert.deepEqual(second, [0, null, null]);

	// x's $3 belongs to the previous call
	const third = [0];
	t.assert.strictEqual(slot(":x", third, params, q), "$2");
	t.assert.deepEqual(third, [0, null]);
});

test("slot binds correct values across interleaved calls", (t) => {
	const q = slots([], ["x", "y"]);
	const params = { x: 1, y: 2 };
	const a = [];
	const b = [];
	t.assert.strictEqual(slot(":x", a, params, q), "$1");
	t.assert.strictEqual(slot(":y", b, params, q), "$1");
	t.assert.strictEqual(slot(":x and :y", a, params, q), "$2 and $3");
	t.assert.strictEqual(slot(":x and :y", b, params, q), "$2 and $3");
	t.assert.deepEqual(a, [1, 1, 2]);
	t.assert.deepEqual(b, [2, 1, 2]);
});

test("slot placeholders past the precomputed ones", (t) => {
	const q = slots([], ["x"]);
	const values = [0, 0];
	t.assert.strictEqual(slot(":x", values, { x: 1 }, q), "$3");
});

test("slot leaves non-params alone", (t) => {
	const q = slots(["a"], []);
	const values = [1];
	t.assert.strictEqual(
		slot("x::int = :a::int and '12:30' and '\\:a' and :unknown and : and :", values, {}, q),
		"x::int = $1::int and '12:30' and '\\:a' and :unknown and : and :",
	);
	t.assert.deepEqual(values, [1]);
});

test("slot strips required markers but not operators", (t) => {
	const q = slots(["a"], []);
	t.assert.strictEqual(slot(":a! and :a!= 1 and :a!~ 'x' and :a!", [1], {}, q), "$1 and $1!= 1 and $1!~ 'x' and $1");
});

test("slot handles params at the edges", (t) => {
	const q = slots(["a", "b"], []);
	t.assert.strictEqual(slot(":a", [1, 2], {}, q), "$1");
	t.assert.strictEqual(slot(":a:b", [1, 2], {}, q), "$1:b");
	t.assert.strictEqual(slot("(:a)", [1, 2], {}, q), "($1)");
});

test("slot inlines escaped values for multi-statement queries", (t) => {
	const q = slots(["a"], ["x"], (v) => `'${v}'`);
	t.assert.strictEqual(slot(":a and :x and :x", null, { a: "1", x: "2" }, q), "'1' and '2' and '2'");
});
