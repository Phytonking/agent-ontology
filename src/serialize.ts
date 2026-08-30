import matter from "gray-matter";
import type { TypeFrontmatter, ActionFrontmatter, ConnectorFrontmatter, ConnectionFrontmatter, PipelineFrontmatter } from "./types.js";

/** Render a type as a markdown file: YAML frontmatter (schema) + prose body. */
export function renderType(fm: TypeFrontmatter, body: string): string {
  return matter.stringify(`\n${body.trim()}\n`, fm as Record<string, unknown>);
}

/** Render an action as a markdown file: YAML frontmatter + prose body. */
export function renderAction(fm: ActionFrontmatter, body: string): string {
  return matter.stringify(`\n${body.trim()}\n`, fm as Record<string, unknown>);
}

/** Render a connector as a markdown file: YAML frontmatter + prose body. */
export function renderConnector(fm: ConnectorFrontmatter, body: string): string {
  return matter.stringify(`\n${body.trim()}\n`, fm as Record<string, unknown>);
}

/** Render a pipeline as a markdown file: YAML frontmatter + prose body. */
export function renderPipeline(fm: PipelineFrontmatter, body: string): string {
  return matter.stringify(`\n${body.trim()}\n`, fm as Record<string, unknown>);
}

/** Render a connection as a markdown file: YAML frontmatter + prose body. */
export function renderConnection(fm: ConnectionFrontmatter, body: string): string {
  return matter.stringify(`\n${body.trim()}\n`, fm as Record<string, unknown>);
}
