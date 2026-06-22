import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { Container, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { ASSISTANT_SEPARATOR_PATCH, COMPONENT_PARENT, CONTAINER_PARENT_PATCH, TOOL_EXECUTION_GROUP_PATCH } from "./constants.ts";
import { getCodingAgentRoot } from "./paths.ts";

const TOOL_SUMMARY_WIDTH = 48;
const MAX_TOOL_ROWS = 8;
const PREVIOUS_TOOL_PATCHES = [
  Symbol.for("local.ui-optimize.tool-execution.group.patch.v2"),
  Symbol.for("local.ui-optimize.tool-execution.group.patch.v3"),
  Symbol.for("local.ui-optimize.tool-execution.group.patch.v4"),
];
const PREVIOUS_ASSISTANT_PATCHES = [Symbol.for("local.ui-optimize.assistant-separator.patch.v1")];

type ParentAware = { [COMPONENT_PARENT]?: { children?: unknown[] } };

type ToolLike = ParentAware & {
  expanded?: boolean;
  toolName?: string;
  args?: unknown;
  result?: { isError?: boolean; content?: Array<{ type: string; text?: string }> };
  executionStarted?: boolean;
};

type AssistantContent = { type?: string; text?: string; thinking?: string };

type AssistantLike = ParentAware & {
  hideThinkingBlock?: boolean;
  lastMessage?: { content?: AssistantContent[] };
};

type AssistantInfo = {
  hasText: boolean;
  hasThinking: boolean;
  hasToolCall: boolean;
  thinkingTexts: string[];
  hideThinkingBlock: boolean;
};

type RenderPatchState = { originalRender: (width: number) => string[] };

type ToolGroup = {
  tools: ToolLike[];
  thinkingTexts: string[];
};

function installContainerParentPatch(): void {
  const proto = Container.prototype as unknown as Record<PropertyKey, unknown>;
  if (proto[CONTAINER_PARENT_PATCH]) return;

  const original = proto.addChild as (component: unknown) => void;
  if (typeof original !== "function") return;

  proto[CONTAINER_PARENT_PATCH] = true;
  proto.addChild = function (component: unknown): void {
    if (component && typeof component === "object") {
      try {
        Object.defineProperty(component, COMPONENT_PARENT, { value: this, configurable: true });
      } catch {
        // Ignore non-extensible components.
      }
    }
    return original.call(this, component);
  };
}

function componentName(value: unknown): string | undefined {
  return value && typeof value === "object" ? (value as { constructor?: { name?: string } }).constructor?.name : undefined;
}

function getOriginalRender(proto: Record<PropertyKey, unknown>, previousPatches: symbol[]): ((width: number) => string[]) | undefined {
  for (const symbol of previousPatches) {
    const state = proto[symbol] as RenderPatchState | undefined;
    if (typeof state?.originalRender === "function") return state.originalRender;
  }

  const render = proto.render;
  return typeof render === "function" ? render as (width: number) => string[] : undefined;
}

function isToolComponent(value: unknown): value is ToolLike {
  return componentName(value) === "ToolExecutionComponent";
}

function normalizeInline(text: string | undefined): string | undefined {
  const normalized = text?.trim().replace(/\s+/g, " ");
  return normalized || undefined;
}

function getAssistantInfo(value: unknown): AssistantInfo | undefined {
  if (componentName(value) !== "AssistantMessageComponent") return undefined;

  const assistant = value as AssistantLike;
  const content = assistant.lastMessage?.content ?? [];
  if (content.length === 0) return undefined;

  const thinkingTexts = content
    .filter((item) => item.type === "thinking")
    .map((item) => normalizeInline(item.thinking))
    .filter((text): text is string => Boolean(text));

  return {
    hasText: content.some((item) => item.type === "text" && Boolean(normalizeInline(item.text))),
    hasThinking: thinkingTexts.length > 0,
    hasToolCall: content.some((item) => item.type === "toolCall"),
    thinkingTexts,
    hideThinkingBlock: assistant.hideThinkingBlock !== false,
  };
}

function isAssistantActivitySeparator(value: unknown): value is AssistantLike {
  const info = getAssistantInfo(value);
  return Boolean(info && !info.hasText && (info.hasThinking || info.hasToolCall));
}

function isHideableActivitySeparator(value: unknown): value is AssistantLike {
  const info = getAssistantInfo(value);
  if (!info || !isAssistantActivitySeparator(value)) return false;

  // Tool-call-only messages have no visible assistant content in Pi's native
  // renderer. Thinking messages are hideable only while the user setting keeps
  // thinking collapsed; expanded thinking should remain visible and split groups.
  return !info.hasThinking || info.hideThinkingBlock;
}

function getHideableThinkingTexts(value: unknown): string[] {
  const info = getAssistantInfo(value);
  if (!info?.hasThinking || !info.hideThinkingBlock) return [];
  return info.thinkingTexts;
}

function hasCollapsedToolBefore(children: unknown[], index: number): boolean {
  for (let i = index - 1; i >= 0; i--) {
    const child = children[i];
    if (isToolComponent(child)) return !child.expanded;
    if (isHideableActivitySeparator(child)) continue;
    return false;
  }
  return false;
}

function hasCollapsedToolAfter(children: unknown[], index: number): boolean {
  for (let i = index + 1; i < children.length; i++) {
    const child = children[i];
    if (isToolComponent(child)) return !child.expanded;
    if (isHideableActivitySeparator(child)) continue;
    return false;
  }
  return false;
}

function shouldHideAssistantSeparator(assistant: AssistantLike): boolean {
  if (!isHideableActivitySeparator(assistant)) return false;

  const children = assistant[COMPONENT_PARENT]?.children;
  if (!children) return false;

  const index = children.indexOf(assistant);
  return index >= 0 && hasCollapsedToolAfter(children, index);
}

function collectLeadingThinkingTexts(children: unknown[], index: number): string[] {
  const texts: string[] = [];

  for (let i = index - 1; i >= 0; i--) {
    const child = children[i];
    if (!isHideableActivitySeparator(child)) break;
    texts.unshift(...getHideableThinkingTexts(child));
  }

  return texts;
}

function collectToolGroup(first: ToolLike): ToolGroup | undefined {
  const children = first[COMPONENT_PARENT]?.children;
  if (!children) return undefined;

  const index = children.indexOf(first);
  if (index < 0 || hasCollapsedToolBefore(children, index)) return undefined;

  const tools: ToolLike[] = [];
  const thinkingTexts = collectLeadingThinkingTexts(children, index);
  let pendingThinkingTexts: string[] = [];

  for (let i = index; i < children.length; i++) {
    const child = children[i];

    if (isAssistantActivitySeparator(child)) {
      if (!isHideableActivitySeparator(child)) break;
      pendingThinkingTexts.push(...getHideableThinkingTexts(child));
      continue;
    }

    if (!isToolComponent(child) || child.expanded) break;

    if (tools.length > 0 && pendingThinkingTexts.length > 0) {
      thinkingTexts.push(...pendingThinkingTexts);
    }
    pendingThinkingTexts = [];
    tools.push(child);
  }

  return tools.length > 0 ? { tools, thinkingTexts } : undefined;
}

function toolStatus(tool: ToolLike): string {
  if (tool.result?.isError) return "✗";
  if (tool.result) return "✓";
  if (tool.executionStarted) return "…";
  return "○";
}

function toolState(tool: ToolLike): string {
  if (tool.result?.isError) return "failed";
  if (tool.result) return "done";
  if (tool.executionStarted) return "running";
  return "pending";
}

function toolArgSummary(tool: ToolLike): string {
  const args = tool.args;
  if (!args || typeof args !== "object") return "";

  const input = args as Record<string, unknown>;
  const value = input.command ?? input.path ?? input.file_path ?? input.query ?? input.url ?? input.action;
  return typeof value === "string" && value.length > 0
    ? ` ${truncateToWidth(value.replace(/\s+/g, " "), TOOL_SUMMARY_WIDTH, "…")}`
    : "";
}

function firstErrorLine(tools: ToolLike[]): string | undefined {
  const error = tools.find((tool) => tool.result?.isError);
  const text = error?.result?.content?.find((item) => item.type === "text" && item.text)?.text?.trim();
  return text ? `  error: ${text.split("\n")[0]}` : undefined;
}

function compactStartToWidth(text: string, width: number): string {
  if (width <= 1) return "…";
  if (visibleWidth(text) <= width) return text;

  // Keep a small hint from the beginning and preserve more of the recent tail.
  // Thinking blocks usually end with the actionable decision, so compressing the
  // start is more useful than chopping off the end.
  const headWidth = Math.min(18, Math.max(6, Math.floor(width * 0.22)));
  const tailWidth = Math.max(1, width - headWidth - 2);
  const head = truncateToWidth(text, headWidth, "");
  let tail = text;
  while (visibleWidth(tail) > tailWidth && tail.length > 0) tail = tail.slice(1);
  return `${head}… ${tail}`;
}

function thinkingLine(thinkingTexts: string[], width: number): string | undefined {
  if (thinkingTexts.length === 0) return undefined;
  return `  💭 ${compactStartToWidth(thinkingTexts.join(" · "), Math.max(1, width - 5))}`;
}

function renderSingleToolGroup(tool: ToolLike, thinkingTexts: string[], width: number): string[] {
  const title = thinkingTexts.length > 0
    ? `💭 Thinking ×${thinkingTexts.length} (Ctrl+T) · 🛠 ${tool.toolName ?? "tool"} (Ctrl+O)${toolArgSummary(tool)}`
    : `🛠 ${tool.toolName ?? "tool"} (Ctrl+O)${toolArgSummary(tool)}`;

  const lines = ["", truncateToWidth(title, width, ""), truncateToWidth(`  ${toolStatus(tool)} ${toolState(tool)}`, width, "")];
  const thought = thinkingLine(thinkingTexts, width);
  if (thought) lines.push(truncateToWidth(thought, width, ""));
  return lines;
}

function renderMultiToolGroup(tools: ToolLike[], thinkingTexts: string[], width: number): string[] {
  const counts = new Map<string, number>();
  for (const tool of tools) counts.set(tool.toolName ?? "tool", (counts.get(tool.toolName ?? "tool") ?? 0) + 1);

  const summary = [...counts.entries()].map(([name, count]) => `${name}${count > 1 ? ` ×${count}` : ""}`).join(", ");
  const done = tools.filter((tool) => tool.result && !tool.result.isError).length;
  const failed = tools.filter((tool) => tool.result?.isError).length;
  const running = tools.length - done - failed;
  const title = thinkingTexts.length > 0
    ? `💭 Thinking ×${thinkingTexts.length} (Ctrl+T) · 🛠 Tools ×${tools.length} (Ctrl+O): ${summary}`
    : `🛠 Tools ×${tools.length} (Ctrl+O): ${summary}`;

  const lines = [
    "",
    truncateToWidth(title, width, ""),
    truncateToWidth(`  ${done} done${running ? `, ${running} running` : ""}${failed ? `, ${failed} failed` : ""}`, width, ""),
  ];

  const thought = thinkingLine(thinkingTexts, width);
  if (thought) lines.push(truncateToWidth(thought, width, ""));

  for (const tool of tools.slice(0, MAX_TOOL_ROWS)) {
    lines.push(truncateToWidth(`  ${toolStatus(tool)} ${tool.toolName ?? "tool"}${toolArgSummary(tool)}`, width, ""));
  }

  if (tools.length > MAX_TOOL_ROWS) {
    const remaining = tools.length - MAX_TOOL_ROWS;
    lines.push(truncateToWidth(`  … ${remaining} more tool call${remaining === 1 ? "" : "s"}`, width, ""));
  }

  return lines;
}

function renderToolGroup(first: ToolLike, width: number): string[] | undefined {
  const group = collectToolGroup(first);
  if (!group) return undefined;

  const lines = group.tools.length === 1
    ? renderSingleToolGroup(group.tools[0]!, group.thinkingTexts, width)
    : renderMultiToolGroup(group.tools, group.thinkingTexts, width);

  const errorLine = firstErrorLine(group.tools);
  if (errorLine) lines.push(truncateToWidth(errorLine, width, ""));
  return lines;
}

function isContinuationOfCollapsedToolGroup(tool: ToolLike): boolean {
  const children = tool[COMPONENT_PARENT]?.children;
  if (!children) return false;

  const index = children.indexOf(tool);
  return index >= 0 && hasCollapsedToolBefore(children, index);
}

async function loadInteractiveComponents(): Promise<{
  ToolExecutionComponent?: { prototype: Record<PropertyKey, unknown> };
  AssistantMessageComponent?: { prototype: Record<PropertyKey, unknown> };
}> {
  const root = getCodingAgentRoot();
  const toolExecutionUrl = pathToFileURL(join(root, "dist/modes/interactive/components/tool-execution.js")).href;
  const assistantMessageUrl = pathToFileURL(join(root, "dist/modes/interactive/components/assistant-message.js")).href;

  const [{ ToolExecutionComponent }, { AssistantMessageComponent }] = await Promise.all([
    import(toolExecutionUrl) as Promise<{ ToolExecutionComponent?: { prototype: Record<PropertyKey, unknown> } }>,
    import(assistantMessageUrl) as Promise<{ AssistantMessageComponent?: { prototype: Record<PropertyKey, unknown> } }>,
  ]);

  return { ToolExecutionComponent, AssistantMessageComponent };
}

export async function installToolExecutionGroupingPatch(): Promise<void> {
  installContainerParentPatch();

  let components: Awaited<ReturnType<typeof loadInteractiveComponents>>;
  try {
    components = await loadInteractiveComponents();
  } catch (error) {
    console.warn(`[ui-optimize] skipped tool grouping patch: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const toolProto = components.ToolExecutionComponent?.prototype;
  if (toolProto) {
    const original = getOriginalRender(toolProto, [TOOL_EXECUTION_GROUP_PATCH, ...PREVIOUS_TOOL_PATCHES]);
    if (original) {
      toolProto[TOOL_EXECUTION_GROUP_PATCH] = { originalRender: original } satisfies RenderPatchState;
      toolProto.render = function (width: number): string[] {
        const self = this as ToolLike;
        if (self.expanded) return original.call(this, width);
        if (isContinuationOfCollapsedToolGroup(self)) return [];
        return renderToolGroup(self, width) ?? original.call(this, width);
      };
    }
  }

  const assistantProto = components.AssistantMessageComponent?.prototype;
  if (assistantProto) {
    const original = getOriginalRender(assistantProto, [ASSISTANT_SEPARATOR_PATCH, ...PREVIOUS_ASSISTANT_PATCHES]);
    if (original) {
      assistantProto[ASSISTANT_SEPARATOR_PATCH] = { originalRender: original } satisfies RenderPatchState;
      assistantProto.render = function (width: number): string[] {
        return shouldHideAssistantSeparator(this as AssistantLike) ? [] : original.call(this, width);
      };
    }
  }
}
