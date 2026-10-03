const CONTEXT_MARKER = "Context from other agents (JSON):";

/** The user message each agent receives: the customer's message plus prior agents' structured outputs. */
export function buildAgentPrompt(message: string, context: Record<string, unknown>): string {
  const parts = [`Customer message:\n${message}`];
  if (Object.keys(context).length > 0) parts.push(`${CONTEXT_MARKER}\n${JSON.stringify(context, null, 2)}`);
  return parts.join("\n\n");
}

export function parseAgentPrompt(text: string): { message: string; context: Record<string, any> } {
  const [head, json] = text.split(CONTEXT_MARKER);
  return {
    message: head.replace(/^Customer message:\n/, "").trim(),
    context: json ? JSON.parse(json) : {},
  };
}
