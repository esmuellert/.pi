/**
 * The built-in tools this package can take over, and how to reach them.
 *
 * pi exports a factory per tool but not the ToolDefinition type, so the shapes
 * are read back off a factory. Deriving them from the function being wrapped is
 * also the stricter choice: they cannot drift from it.
 */

import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";

export type ToolName = "read" | "bash" | "edit" | "write" | "ls" | "grep" | "find";

/** Every tool this package wraps, in the order pi lists them. */
export const TOOLS: readonly ToolName[] = ["read", "bash", "edit", "write", "ls", "grep", "find"];

export type BuiltIn = ReturnType<typeof createReadToolDefinition>;
export type RenderCall = NonNullable<BuiltIn["renderCall"]>;
export type RenderArgs = Parameters<RenderCall>[0];
export type RenderContext = Parameters<RenderCall>[2];

const FACTORY = {
	read: createReadToolDefinition,
	bash: createBashToolDefinition,
	edit: createEditToolDefinition,
	write: createWriteToolDefinition,
	ls: createLsToolDefinition,
	grep: createGrepToolDefinition,
	find: createFindToolDefinition,
} as unknown as Readonly<Record<ToolName, (cwd: string) => BuiltIn>>;

/** pi's own definition for a tool, as it ships. */
export function builtIn(tool: ToolName, cwd: string): BuiltIn {
	return FACTORY[tool](cwd);
}
