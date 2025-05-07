import type { Plugin } from "vite";

export default function postgres(opts?: {
	/**
	 * Path to a folder where all declaration are kept relative to `rootFolder`, i.e. a file at path `src/sql/module.sql` will have its `.d.ts` file generated into `${typesFolder}/src/sql/module.sql.d.ts`. Make sure you include this one in your `tsconfig.json`.
	 *
	 * @default "node_modules/@types/vite-plugin-postgres-import/"
	 */
	typesFolder?: string;
	/**
	 * **CURRENTLY DISABLED**. This one changes the type declaration generation strategy to generate everything as `declare module` statements.
	 */
	modulePrefix?: string;
	/**
	 * Root folder relative to which path calculation will be happening. May be useful for some I guess.
	 *
	 * @default process.cwd()
	 */
	rootFolder?: string;
}): Plugin;
