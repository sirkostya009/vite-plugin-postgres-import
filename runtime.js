/**
 * @typedef {{
 *   index: Map<string, number>,
 *   k: number,
 *   ph: string[],
 *   pos: Int32Array,
 *   mark: Float64Array,
 *   epoch: number,
 *   cur: unknown[] | null,
 *   esc: ((value: string) => string) | undefined,
 * }} Slots
 */

/**
 * Static binding state of a query with slots. Own params map to their `$N`, slot params to `~j`.
 * @param {string[]} own
 * @param {string[]} extra
 * @param {(value: string) => string} [esc] inlines values instead of binding them, for multi-statement queries
 * @returns {Slots}
 */
export function slots(own, extra, esc) {
	const index = new Map(own.map((p, i) => [p, i + 1]));
	for (let j = 0; j < extra.length; ++j) if (!index.has(extra[j])) index.set(extra[j], ~j);
	const ph = [];
	for (let i = 1; i <= own.length + extra.length; ++i) ph.push("$" + i);
	return {
		index,
		k: own.length,
		ph,
		pos: new Int32Array(extra.length),
		mark: new Float64Array(extra.length),
		epoch: 0,
		cur: null,
		esc,
	};
}

const word = (/** @type {number} */ c) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;

/**
 * Binds `:param` placeholders of a slot's text, appending slot params to `values` on first use.
 *
 * A call is identified by its `values` array, a different one starts a new epoch.
 * `pos[j]` is only trusted when `mark[j]` was set in the current epoch.
 * @param {string} s
 * @param {unknown[] | null} values
 * @param {Record<string, unknown>} params
 * @param {Slots} q
 */
export function slot(s, values, params, q) {
	let i = s.indexOf(":");
	if (i < 0) return s;
	let out = "";
	let last = 0;
	for (; i >= 0; i = s.indexOf(":", i + 1)) {
		const prev = i ? s.charCodeAt(i - 1) : 0;
		if (prev === 58 || prev === 92 || word(prev)) continue;
		let end = i + 1;
		while (end < s.length && word(s.charCodeAt(end))) ++end;
		if (end === i + 1) continue;
		const name = s.slice(i + 1, end);
		const n = q.index.get(name);
		if (n === undefined) {
			i = end - 1;
			continue;
		}
		let p;
		if (q.esc) {
			p = q.esc(/** @type {string} */ (params[name]));
		} else if (n > 0) {
			p = q.ph[n - 1];
		} else {
			const j = ~n;
			if (q.cur !== values) {
				q.cur = values;
				++q.epoch;
			}
			let N = q.pos[j];
			if (q.mark[j] !== q.epoch) {
				N = q.pos[j] = /** @type {unknown[]} */ (values).push(params[name]);
				q.mark[j] = q.epoch;
			}
			p = q.ph[N - 1] ?? "$" + N;
		}
		if (s.charCodeAt(end) === 33) {
			const c = s.charCodeAt(end + 1);
			if (c !== 61 && c !== 126) ++end;
		}
		out += s.slice(last, i) + p;
		last = end;
		i = end - 1;
	}
	return last ? out + s.slice(last) : s;
}
