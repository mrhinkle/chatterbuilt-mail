import type { SearchQuery } from "./imap-session.js";
import { slugLabel } from "./imap-folders.js";

export interface FolderView {
  role: string | null;
  display: string;
}

export interface PostFilter {
  kind: "filename" | "attachment";
  value: string;
  neg: boolean;
}

export interface CompiledSearch {
  query: SearchQuery | "none" | "all";
  post: PostFilter[];
}

type Node =
  | { type: "term"; neg: boolean; key: string; value: string }
  | { type: "text"; neg: boolean; value: string }
  | { type: "and"; terms: Node[] }
  | { type: "or"; left: Node; right: Node };

const KNOWN = new Set([
  "from", "to", "cc", "subject", "in", "label", "is", "newer_than", "older_than", "before",
  "list", "filename", "has", "category",
]);

/** Empty query is the inbox. `category:` and `is:important` match nothing. A negated one adds no constraint. */
export function compileQuery(input: string, folder: FolderView, now: Date): CompiledSearch {
  const source = input.trim() ? input : "in:inbox";
  const tokens = tokenize(source);
  const [node] = parseOr(tokens, 0);
  return compile(node, folder, now);
}

function compile(node: Node, folder: FolderView, now: Date): CompiledSearch {
  if (node.type === "or") {
    const left = compile(node.left, folder, now);
    const right = compile(node.right, folder, now);
    if (left.query === "none") return right;
    if (right.query === "none") return left;
    if (left.query === "all") return { query: "all", post: [...left.post, ...right.post] };
    if (right.query === "all") return { query: "all", post: [...left.post, ...right.post] };
    return { query: { or: [asQuery(left.query), asQuery(right.query)] }, post: [...left.post, ...right.post] };
  }
  if (node.type === "and") {
    const parts = node.terms.map((term) => compile(term, folder, now));
    if (parts.some((part) => part.query === "none")) return { query: "none", post: [] };
    const post = parts.flatMap((part) => part.post);
    const queries = parts.flatMap((part) => (part.query === "all" || part.query === "none" ? [] : [part.query]));
    if (queries.length === 0) return { query: "all", post };
    if (queries.length === 1) return { query: queries[0] ?? "all", post };
    return { query: { and: queries }, post };
  }
  if (node.type === "text") {
    const text = { text: node.value };
    return node.neg ? { query: { not: text }, post: [] } : { query: text, post: [] };
  }
  return compileTerm(node.key, node.value, node.neg, folder, now);
}

function asQuery(query: SearchQuery | "all"): SearchQuery {
  return query === "all" ? { all: true } : query;
}

function compileTerm(key: string, value: string, neg: boolean, folder: FolderView, now: Date): CompiledSearch {
  const op = key.toLowerCase();
  if (!KNOWN.has(op)) return neg ? { query: "all", post: [] } : { query: "none", post: [] };
  if (op === "category") return neg ? { query: "all", post: [] } : { query: "none", post: [] };
  if (op === "is" && value.toLowerCase() === "important") return neg ? { query: "all", post: [] } : { query: "none", post: [] };
  if (op === "in") {
    const hit = inMatches(value, folder);
    return { query: neg ? (hit ? "none" : "all") : (hit ? "all" : "none"), post: [] };
  }
  if (op === "label") {
    const want = value.toLowerCase();
    const hit = slugLabel(folder.display) === want || folder.display.toLowerCase() === want || folder.role?.toLowerCase() === want;
    return { query: neg ? (hit ? "none" : "all") : (hit ? "all" : "none"), post: [] };
  }
  if (op === "filename") return { query: "all", post: [{ kind: "filename", value, neg }] };
  if (op === "has") {
    if (value.toLowerCase() !== "attachment") return { query: "none", post: [] };
    return { query: "all", post: [{ kind: "attachment", value: "attachment", neg }] };
  }
  const query = termQuery(op, value, now);
  if (!query) return { query: "none", post: [] };
  return { query: neg ? { not: query } : query, post: [] };
}

function inMatches(value: string, folder: FolderView): boolean {
  const name = value.toLowerCase();
  if (name === "anywhere") return true;
  const role = folder.role?.toLowerCase() ?? "";
  if (name === "inbox") return role === "inbox";
  if (name === "sent") return role === "sent";
  if (name === "draft" || name === "drafts") return role === "draft";
  if (name === "trash") return role === "trash";
  if (name === "spam") return role === "spam";
  if (name === "archive") return role === "archive";
  return slugLabel(folder.display) === name || folder.display.toLowerCase() === name;
}

function termQuery(op: string, value: string, now: Date): SearchQuery | null {
  if (op === "from") return { from: value };
  if (op === "to") return { to: value };
  if (op === "cc") return { cc: value };
  if (op === "subject") return { subject: value };
  if (op === "list") return { header: { name: "List-Id", value } };
  if (op === "is") {
    const flag = value.toLowerCase();
    if (flag === "unread") return { seen: false };
    if (flag === "read") return { seen: true };
    if (flag === "starred") return { flagged: true };
    return null;
  }
  if (op === "newer_than" || op === "older_than") {
    const days = /^(\d+)d$/i.exec(value);
    if (!days?.[1]) return null;
    const date = shiftDays(now, -Number(days[1]));
    return op === "newer_than" ? { since: date } : { before: date };
  }
  if (op === "before") {
    const match = /^(\d{4})[/-](\d{2})[/-](\d{2})$/.exec(value);
    if (!match) return null;
    return { before: `${match[1]}-${match[2]}-${match[3]}` };
  }
  return null;
}

function shiftDays(now: Date, days: number): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function tokenize(input: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i] ?? "";
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === "(" || ch === ")") {
      out.push(ch);
      i += 1;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let text = "";
      while (j < input.length && input[j] !== '"') {
        text += input[j];
        j += 1;
      }
      out.push(`"${text}"`);
      i = j + 1;
      continue;
    }
    let j = i;
    let text = "";
    while (j < input.length) {
      const next = input[j] ?? "";
      if (next === '"') {
        text += '"';
        j += 1;
        while (j < input.length && input[j] !== '"') {
          text += input[j] ?? "";
          j += 1;
        }
        if (input[j] === '"') {
          text += '"';
          j += 1;
        }
        continue;
      }
      if (/\s/.test(next) || next === "(" || next === ")") break;
      text += next;
      j += 1;
    }
    if (text.length > 0) out.push(text);
    i = j;
  }
  return out;
}

function parseOr(tokens: string[], index: number): [Node, number] {
  let [left, i] = parseAnd(tokens, index);
  while (tokens[i]?.toUpperCase() === "OR") {
    const [right, next] = parseAnd(tokens, i + 1);
    left = { type: "or", left, right };
    i = next;
  }
  return [left, i];
}

function parseAnd(tokens: string[], index: number): [Node, number] {
  const terms: Node[] = [];
  let i = index;
  while (i < tokens.length && tokens[i] !== ")" && tokens[i]?.toUpperCase() !== "OR") {
    const [node, next] = parsePrimary(tokens, i);
    terms.push(node);
    i = next;
  }
  if (terms.length === 0) return [{ type: "text", neg: false, value: "" }, i];
  if (terms.length === 1) return [terms[0] as Node, i];
  return [{ type: "and", terms }, i];
}

function parsePrimary(tokens: string[], index: number): [Node, number] {
  const token = tokens[index] ?? "";
  if (token === "(") {
    const [node, next] = parseOr(tokens, index + 1);
    const after = tokens[next] === ")" ? next + 1 : next;
    return [node, after];
  }
  let neg = false;
  let body = token;
  if (body.startsWith("-") && body.length > 1) {
    neg = true;
    body = body.slice(1);
  }
  if (body.startsWith('"') && body.endsWith('"')) {
    return [{ type: "text", neg, value: body.slice(1, -1) }, index + 1];
  }
  const colon = body.indexOf(":");
  if (colon > 0) {
    const key = body.slice(0, colon);
    let value = body.slice(colon + 1);
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    return [{ type: "term", neg, key, value }, index + 1];
  }
  return [{ type: "text", neg, value: body }, index + 1];
}
