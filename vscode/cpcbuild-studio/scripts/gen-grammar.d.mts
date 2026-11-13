export const GRAMMAR_FILE: string;
export const KEYWORDS_MODULE: string;
export function generateGrammar(keywords: readonly { name: string; kind: string; status: string; reserved: boolean }[]): Record<string, unknown>;
export function grammarText(keywords: readonly { name: string; kind: string; status: string; reserved: boolean }[]): string;
