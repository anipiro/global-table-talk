/** Shows **bold** from agent-written text as bold instead of asterisks. */
export function renderBold(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part.replace(/\*\*/g, ""),
  );
}
