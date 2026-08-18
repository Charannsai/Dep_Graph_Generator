import OpenAI from "openai";
import { ParsedTool, Edge } from "./types.js";

export async function inferDependenciesWithLLM(tools: ParsedTool[]): Promise<Edge[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseURL = process.env.OPENAI_BASE_URL;
  const model = process.env.OPENAI_MODEL || "openai/gpt-4o-mini";

  if (!apiKey) {
    console.error("No OPENAI_API_KEY detected in environment; skipping LLM enrichment pass.");
    return [];
  }

  const client = new OpenAI({
    apiKey,
    baseURL: baseURL || undefined,
  });

  const toolBySlug = new Map(tools.map((t) => [t.slug, t]));
  const clusters = clusterToolsByDomain(tools);
  const edges: Edge[] = [];
  const edgeKeySet = new Set<string>();

  console.error(`Running LLM dependency inference across ${clusters.size} service clusters using ${model}...`);

  for (const [service, clusterTools] of clusters.entries()) {
    if (clusterTools.length < 2) continue;

    try {
      const summaryList = clusterTools.map((t) => ({
        slug: t.slug,
        name: t.name,
        actionType: t.actionType,
        inputs: t.inputParameters.map((p) => ({
          name: p.name,
          required: p.required,
          description: p.description.slice(0, 100),
        })),
      }));

      const prompt = `You are an expert AI agent architect analyzing tool dependencies for an agent execution graph.
Analyze the following tools in the '${service}' domain and identify prerequisite dependencies: which tool produces a parameter (e.g. id, number, key, slug, sha, name) required by another tool.

Tools:
${JSON.stringify(summaryList, null, 2)}

Requirements:
1. Return a JSON object with a "dependencies" array of edges.
2. Each edge must have:
   - "from": producer tool slug (must be one of the provided slugs)
   - "to": consumer tool slug (must be one of the provided slugs)
   - "label": the exact input parameter name of the consumer tool that the producer provides (e.g. "issue_number", "pull_number", "invitation_id", "workflow_id", "run_id", "release_id", "comment_id", "branch", "gist_id").
3. Do NOT invent slugs. All slugs must be exact matches from the list.
4. "from" must be an action that discovers or creates the entity (e.g. LIST, SEARCH, GET, CREATE).
5. Output valid JSON only, inside a \`\`\`json markdown block.`;

      const response = await client.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
      });

      const content = response.choices[0]?.message?.content || "";
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || [null, content];
      const parsed = JSON.parse(jsonMatch[1]?.trim() || "{}");

      if (Array.isArray(parsed.dependencies)) {
        for (const dep of parsed.dependencies) {
          if (
            dep &&
            typeof dep.from === "string" &&
            typeof dep.to === "string" &&
            typeof dep.label === "string" &&
            dep.from !== dep.to &&
            toolBySlug.has(dep.from) &&
            toolBySlug.has(dep.to)
          ) {
            const consumer = toolBySlug.get(dep.to);
            // Verify consumer actually accepts this parameter
            if (consumer?.inputParameters.some((p) => p.name === dep.label)) {
              const key = `${dep.from}|${dep.to}|${dep.label}`;
              if (!edgeKeySet.has(key)) {
                edgeKeySet.add(key);
                edges.push({ from: dep.from, to: dep.to, label: dep.label });
              }
            }
          }
        }
      }
    } catch (err: any) {
      console.error(`LLM inference warning on service '${service}':`, err.message || err);
    }
  }

  console.error(`LLM pass discovered ${edges.length} valid dependency edges.`);
  return edges;
}

function clusterToolsByDomain(tools: ParsedTool[]): Map<string, ParsedTool[]> {
  const clusters = new Map<string, ParsedTool[]>();

  for (const tool of tools) {
    const service = tool.service || "general";
    if (!clusters.has(service)) {
      clusters.set(service, []);
    }
    clusters.get(service)!.push(tool);
  }

  return clusters;
}
