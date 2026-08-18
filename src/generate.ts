/**
 * Generator entrypoint. Read a toolkit catalog, infer its dependencies, write a graph.
 *
 * How we run it:
 *   - The path to a toolkit's catalog JSON is passed as a CLI ARGUMENT, e.g.
 *     `node --import tsx src/generate.ts path/to/catalog.json`. We append it as the last
 *     argument, so reading the final argv entry works whatever else your command carries.
 *   - Write your graph to `dependency_graph.json` in the working directory.
 *   - For LLM access, the OpenAI SDK reads OPENAI_API_KEY / OPENAI_BASE_URL from the
 *     environment.
 */
import { readFileSync, writeFileSync } from "fs";
import { config } from "dotenv";
import { Graph, Node, Edge, ParsedTool } from "./types.js";
import { parseTool } from "./schemaParser.js";
import { DependencyMatcher } from "./entityMatcher.js";
import { inferDependenciesWithLLM } from "./llmReasoner.js";

// Load .env if present locally
config();

// The catalog path is the last CLI argument (appended after run command).
const CATALOG_PATH = process.argv.length > 2 ? process.argv[process.argv.length - 1] : undefined;
const OUT_PATH = "dependency_graph.json";

function loadCatalog(): Record<string, any>[] {
  if (!CATALOG_PATH) {
    throw new Error("pass the toolkit catalog path as the last argument");
  }
  const data = JSON.parse(readFileSync(CATALOG_PATH, "utf-8"));
  return Array.isArray(data) ? data : (data.tools ?? data.items ?? []);
}

function slugOf(tool: Record<string, any>): string | undefined {
  return tool.slug ?? tool.name ?? tool.function?.name;
}

export async function generate(rawTools: Record<string, any>[]): Promise<Graph> {
  const parsedTools: ParsedTool[] = [];
  const nodes: Node[] = [];
  const seenSlugs = new Set<string>();

  for (const raw of rawTools) {
    const slug = slugOf(raw);
    if (!slug || seenSlugs.has(slug)) continue;
    seenSlugs.add(slug);

    const parsed = parseTool(raw);
    parsedTools.push(parsed);
    nodes.push({
      id: parsed.slug,
      service: parsed.service,
    });
  }

  // 1. Deterministic Schema & Semantic Cross-Reference
  const matcher = new DependencyMatcher(parsedTools);
  const deterministicEdges = matcher.discoverDependencies();

  // 2. LLM Domain Specialist & Validation Layer (if API key available)
  let llmEdges: Edge[] = [];
  if (process.env.OPENAI_API_KEY) {
    llmEdges = await inferDependenciesWithLLM(parsedTools);
  }

  // 3. Merge and deduplicate edges
  const edgeMap = new Map<string, Edge>();
  for (const edge of [...deterministicEdges, ...llmEdges]) {
    if (!edge.from || !edge.to || edge.from === edge.to) continue;
    // Strict provenance check: only include nodes present in the catalog
    if (!seenSlugs.has(edge.from) || !seenSlugs.has(edge.to)) continue;

    const key = `${edge.from}->${edge.to}:${edge.label || ""}`;
    if (!edgeMap.has(key)) {
      edgeMap.set(key, edge);
    }
  }

  const edges = Array.from(edgeMap.values()).sort((a, b) => {
    if (a.from !== b.from) return a.from.localeCompare(b.from);
    if (a.to !== b.to) return a.to.localeCompare(b.to);
    return (a.label || "").localeCompare(b.label || "");
  });

  return { nodes, edges };
}

async function main() {
  const rawTools = loadCatalog();
  const graph = await generate(rawTools);
  writeFileSync(OUT_PATH, JSON.stringify(graph, null, 2), "utf-8");
  console.error(
    `wrote ${graph.nodes.length} nodes, ${graph.edges.length} edges to ${OUT_PATH}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});