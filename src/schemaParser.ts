import { ToolParameter, ToolOutputProperty, ParsedTool } from "./types.js";

const GENERIC_TAGS = new Set([
  "openworldhint",
  "updatehint",
  "destructivehint",
  "mcpignore",
  "graphql",
  "deprecated",
  "preview",
]);

const ACTION_VERBS = new Set([
  "create",
  "add",
  "new",
  "start",
  "register",
  "fork",
  "enable",
  "disable",
  "list",
  "get",
  "search",
  "find",
  "check",
  "read",
  "fetch",
  "view",
  "update",
  "edit",
  "set",
  "put",
  "patch",
  "modify",
  "transfer",
  "merge",
  "delete",
  "remove",
  "cancel",
  "abort",
  "dismiss",
  "rerun",
  "run",
  "execute",
  "trigger",
  "accept",
  "decline",
  "lock",
  "unlock",
  "pin",
  "unpin",
  "star",
  "unstar",
  "watch",
  "unwatch",
  "sync",
]);

const STOP_WORDS = new Set(["a", "an", "the", "for", "in", "to", "from", "of", "on", "by", "with", "all"]);

export function extractService(tool: Record<string, any>, slug: string): string {
  const tags: string[] = Array.isArray(tool.tags) ? tool.tags : [];
  for (const tag of tags) {
    const cleanTag = tag.trim().toLowerCase();
    if (!GENERIC_TAGS.has(cleanTag) && cleanTag.length > 1) {
      return cleanTag;
    }
  }

  // Infer from slug
  const parts = slug.toLowerCase().split("_");
  // remove toolkit name if present
  if (parts.length > 1 && (parts[0] === "github" || parts[0] === "composio")) {
    parts.shift();
  }
  // remove action verb if first
  if (parts.length > 1 && ACTION_VERBS.has(parts[0])) {
    parts.shift();
  }
  // remove stop words
  const meaningful = parts.filter((p) => !STOP_WORDS.has(p));
  if (meaningful.length > 0) {
    return meaningful[0];
  }
  return "general";
}

export function extractActionType(slug: string, name: string): ParsedTool["actionType"] {
  const s = slug.toUpperCase();
  const n = name.toUpperCase();

  if (s.includes("LIST_") || s.includes("SEARCH_") || n.startsWith("LIST ") || n.startsWith("SEARCH ")) {
    return s.includes("SEARCH_") || n.startsWith("SEARCH ") ? "SEARCH" : "LIST";
  }
  if (s.includes("GET_") || s.includes("CHECK_") || s.includes("FETCH_") || s.includes("READ_") || n.startsWith("GET ") || n.startsWith("READ ")) {
    return "GET";
  }
  if (s.includes("CREATE_") || s.includes("ADD_") || s.includes("START_") || s.includes("NEW_") || s.includes("FORK_") || n.startsWith("CREATE ") || n.startsWith("ADD ")) {
    return "CREATE";
  }
  if (s.includes("UPDATE_") || s.includes("EDIT_") || s.includes("SET_") || s.includes("MERGE_") || s.includes("MODIFY_") || s.includes("PATCH_") || n.startsWith("UPDATE ") || n.startsWith("MERGE ")) {
    return "UPDATE";
  }
  if (s.includes("DELETE_") || s.includes("REMOVE_") || s.includes("CANCEL_") || s.includes("ABORT_") || n.startsWith("DELETE ") || n.startsWith("REMOVE ")) {
    return "DELETE";
  }
  return "ACTION";
}

export function extractTargetEntities(slug: string, name: string, description: string): string[] {
  const entities = new Set<string>();
  const parts = slug.toLowerCase().split("_");

  // Filter out toolkit prefix and verbs
  const filtered = parts.filter(
    (p) =>
      p !== "github" &&
      p !== "composio" &&
      !ACTION_VERBS.has(p) &&
      !STOP_WORDS.has(p) &&
      p.length > 2
  );

  for (const part of filtered) {
    // Stem plural 's'
    const singular = part.endsWith("ies")
      ? part.slice(0, -3) + "y"
      : part.endsWith("es") && !part.endsWith("ses")
      ? part.slice(0, -2)
      : part.endsWith("s") && !part.endsWith("ss")
      ? part.slice(0, -1)
      : part;
    entities.add(singular);
    entities.add(part);
  }

  // Common entity combinations
  const joined = parts.join("_");
  if (joined.includes("issue_comment")) entities.add("issue_comment");
  if (joined.includes("pull_request") || joined.includes("pull")) {
    entities.add("pull_request");
    entities.add("pull");
  }
  if (joined.includes("workflow_run") || joined.includes("run")) {
    entities.add("workflow_run");
    entities.add("run");
  }
  if (joined.includes("repository_invitation") || joined.includes("invitation")) {
    entities.add("invitation");
  }

  return Array.from(entities);
}

export function parseInputParameters(inputParams: any): ToolParameter[] {
  if (!inputParams || typeof inputParams !== "object") return [];
  const properties = inputParams.properties || {};
  const requiredList: string[] = Array.isArray(inputParams.required) ? inputParams.required : [];
  const requiredSet = new Set(requiredList);

  const result: ToolParameter[] = [];
  for (const [name, def] of Object.entries(properties)) {
    if (!def || typeof def !== "object") continue;
    const p = def as any;
    result.push({
      name,
      type: p.type || "string",
      description: p.description || "",
      title: p.title || name,
      required: requiredSet.has(name),
      examples: p.examples,
    });
  }
  return result;
}

export function parseOutputProperties(outputParams: any): Map<string, ToolOutputProperty> {
  const result = new Map<string, ToolOutputProperty>();
  if (!outputParams || typeof outputParams !== "object") return result;

  const defs = outputParams.$defs || outputParams.definitions || {};

  function traverseSchema(schema: any, entityContext?: string) {
    if (!schema || typeof schema !== "object") return;

    if (schema.$ref && typeof schema.$ref === "string") {
      const refName = schema.$ref.replace("#/$defs/", "").replace("#/definitions/", "");
      if (defs[refName]) {
        traverseSchema(defs[refName], refName);
      }
      return;
    }

    if (schema.items) {
      traverseSchema(schema.items, entityContext);
    }

    if (schema.properties && typeof schema.properties === "object") {
      for (const [propName, propDef] of Object.entries(schema.properties)) {
        if (propDef && typeof propDef === "object") {
          const pd = propDef as any;
          result.set(propName, {
            name: propName,
            type: pd.type || "string",
            description: pd.description || "",
            title: pd.title || propName,
            entityName: entityContext,
          });

          // If nested object or ref
          if (pd.$ref) {
            const refName = pd.$ref.replace("#/$defs/", "").replace("#/definitions/", "");
            if (defs[refName]) {
              traverseSchema(defs[refName], refName);
            }
          } else if (pd.properties) {
            traverseSchema(pd, entityContext ? `${entityContext}.${propName}` : propName);
          } else if (pd.items) {
            traverseSchema(pd.items, entityContext ? `${entityContext}.${propName}` : propName);
          }
        }
      }
    }
  }

  // Traverse defs
  for (const [defName, defSchema] of Object.entries(defs)) {
    traverseSchema(defSchema, defName);
  }

  // Traverse data property in outputParameters
  if (outputParams.properties?.data) {
    traverseSchema(outputParams.properties.data);
  }

  return result;
}

export function parseTool(raw: Record<string, any>): ParsedTool {
  const slug = raw.slug ?? raw.name ?? raw.function?.name ?? "";
  const name = raw.name ?? slug;
  const description = raw.description ?? raw.function?.description ?? "";
  const service = extractService(raw, slug);
  const tags = Array.isArray(raw.tags) ? raw.tags : [];
  const actionType = extractActionType(slug, name);
  const targetEntities = extractTargetEntities(slug, name, description);
  const inputParameters = parseInputParameters(raw.inputParameters ?? raw.parameters);
  const requiredInputs = inputParameters.filter((p) => p.required);
  const outputProperties = parseOutputProperties(raw.outputParameters ?? raw.returns);

  return {
    slug,
    name,
    description,
    service,
    tags,
    actionType,
    targetEntities,
    inputParameters,
    requiredInputs,
    outputProperties,
    rawTool: raw,
  };
}
