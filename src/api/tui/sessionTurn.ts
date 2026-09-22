export function buildSkillTask(name: string, body: string, arg: string): string {
  const request = arg.trim() === "" ? "(no extra instructions)" : arg.trim();
  return `Skill ${name}:\n${body}\n\nRequest: ${request}`;
}

export interface MarkdownLine {
  role: string;
  text: string;
}

export function renderTranscriptMarkdown(
  lines: MarkdownLine[],
  sessionId: string,
  model: string,
): string {
  const body = lines
    .map((line) => {
      if (line.role === "user") return `## user\n\n${line.text}`;
      if (line.role === "assistant") return `## assistant\n\n${line.text}`;
      if (line.role === "error") return `**ERROR:** ${line.text}`;
      if (line.role === "diff") return `\`\`\`diff\n${line.text}\n\`\`\``;
      return `> ${line.text}`;
    })
    .join("\n\n");
  return `# Flow transcript\n\nsession: ${sessionId}\nmodel: ${model}\n\n${body}\n`;
}
