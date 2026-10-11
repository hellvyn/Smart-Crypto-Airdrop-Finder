// Writing-style gate for user-facing text (Plan 6 Global Constraints): no banned words, no em dash, straight quotes.
// It reads the string literals of the web copy module and of the core message sources, plus the Plan 6 glossary.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BANNED_WORDS } from "@saf/core";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const repo = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));

const BANNED_PATTERN = new RegExp(`\\b(${BANNED_WORDS.map((w) => w.replace(" ", "\\s+")).join("|")})\\b`, "i");
const FORBIDDEN_CHARS: [string, string][] = [
  ["—", "em dash"],
  ["“", "curly quote"],
  ["”", "curly quote"],
  ["‘", "curly quote"],
  ["’", "curly quote"],
];

/** Every style problem in one piece of text. */
function styleProblems(text: string): string[] {
  const problems: string[] = [];
  const word = BANNED_PATTERN.exec(text);
  if (word) problems.push(`banned word "${word[1]}"`);
  for (const [char, name] of FORBIDDEN_CHARS) if (text.includes(char)) problems.push(name);
  return problems;
}

/** The text of every string literal and template literal part in a TypeScript file. */
function stringLiterals(path: string): string[] {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const texts: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      texts.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return texts;
}

/** The rows of the Plan 6 glossary table (Global Constraints). */
function glossaryRows(): string[] {
  const plan = readFileSync(repo("docs/superpowers/plans/2026-10-10-plan-6-web-curation-ui.md"), "utf8").split("\n");
  const start = plan.findIndex((line) => line.includes("**Glosarium"));
  const end = plan.findIndex((line, i) => i > start && line.includes("Sumber kebenaran teks"));
  return plan.slice(start + 1, end).filter((line) => line.trim().startsWith("|"));
}

function problemsIn(texts: string[]): string[] {
  return texts.flatMap((text) => styleProblems(text).map((problem) => `${problem}: ${JSON.stringify(text)}`));
}

describe("styleProblems", () => {
  it("catches an em dash, a banned word, a banned phrase and curly quotes", () => {
    expect(styleProblems("Cek ulang — tiap pagi")).toEqual(["em dash"]);
    expect(styleProblems("Link ini aman")).toEqual(['banned word "aman"']);
    expect(styleProblems("Totally SAFE")).toEqual(['banned word "SAFE"']);
    expect(styleProblems("Selain itu, cek juga")).toEqual(['banned word "Selain itu"']);
    expect(styleProblems("Dijamin cuan")).toEqual(['banned word "Dijamin"']);
    expect(styleProblems("Pasti  untung")).toEqual(['banned word "Pasti  untung"']);
    expect(styleProblems("“klaim”")).toEqual(["curly quote", "curly quote"]);
  });

  it("leaves ordinary words that only contain a banned word alone", () => {
    expect(styleProblems("Risiko kontrak token, keamanan, nyaman, safeHttpUrl, realme")).toEqual([]);
    expect(styleProblems('Pakai kutip lurus: "klaim" dan titik tengah ·')).toEqual([]);
  });
});

describe("user-facing text follows the writing style", () => {
  it("the glossary table is found and clean", () => {
    const rows = glossaryRows();
    expect(rows.length).toBeGreaterThan(20);
    expect(problemsIn(rows)).toEqual([]);
  });

  it.each([
    "apps/web/lib/copy.ts",
    "packages/core/src/curate/messages.ts",
    "packages/core/src/risk/assess.ts",
    "packages/core/src/risk/dangerous-asks.ts",
  ])("%s", (path) => {
    const texts = stringLiterals(repo(path));
    expect(texts.length).toBeGreaterThan(0);
    expect(problemsIn(texts)).toEqual([]);
  });
});
