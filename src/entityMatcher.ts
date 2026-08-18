import { ParsedTool, Edge } from "./types.js";

// Normalize names for fuzzy matching
function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}

interface EntityRule {
  paramPattern: RegExp;
  entityNames: string[];
  producerVerbs?: string[];
  fieldNames: string[];
}

const KNOWN_ENTITY_RULES: EntityRule[] = [
  {
    paramPattern: /^(?:issue_number|issue_id)$/i,
    entityNames: ["issue", "issues"],
    fieldNames: ["number", "issue_number", "id"],
  },
  {
    paramPattern: /^(?:pull_number|pull_request_number|pr_number)$/i,
    entityNames: ["pull_request", "pull", "pulls"],
    fieldNames: ["number", "pull_number", "id"],
  },
  {
    paramPattern: /^(?:comment_id)$/i,
    entityNames: ["comment", "issue_comment", "pull_request_review_comment", "discussion_comment"],
    fieldNames: ["id", "comment_id"],
  },
  {
    paramPattern: /^(?:invitation_id)$/i,
    entityNames: ["invitation", "repository_invitation"],
    fieldNames: ["id", "invitation_id"],
  },
  {
    paramPattern: /^(?:workflow_id)$/i,
    entityNames: ["workflow", "workflows"],
    fieldNames: ["id", "workflow_id"],
  },
  {
    paramPattern: /^(?:run_id|workflow_run_id)$/i,
    entityNames: ["run", "workflow_run", "runs"],
    fieldNames: ["id", "run_id"],
  },
  {
    paramPattern: /^(?:job_id)$/i,
    entityNames: ["job", "jobs"],
    fieldNames: ["id", "job_id"],
  },
  {
    paramPattern: /^(?:release_id)$/i,
    entityNames: ["release", "releases"],
    fieldNames: ["id", "release_id"],
  },
  {
    paramPattern: /^(?:gist_id)$/i,
    entityNames: ["gist", "gists"],
    fieldNames: ["id", "gist_id"],
  },
  {
    paramPattern: /^(?:milestone_number|milestone_id)$/i,
    entityNames: ["milestone", "milestones"],
    fieldNames: ["number", "milestone_number", "id"],
  },
  {
    paramPattern: /^(?:hook_id|webhook_id)$/i,
    entityNames: ["hook", "webhook", "webhooks"],
    fieldNames: ["id", "hook_id"],
  },
  {
    paramPattern: /^(?:secret_name)$/i,
    entityNames: ["secret", "secrets"],
    fieldNames: ["name", "secret_name"],
  },
  {
    paramPattern: /^(?:variable_name)$/i,
    entityNames: ["variable", "variables"],
    fieldNames: ["name", "variable_name"],
  },
  {
    paramPattern: /^(?:environment_name)$/i,
    entityNames: ["environment", "environments"],
    fieldNames: ["name", "environment_name"],
  },
  {
    paramPattern: /^(?:alert_number)$/i,
    entityNames: ["alert", "alerts", "code_scanning", "secret_scanning", "dependabot"],
    fieldNames: ["number", "alert_number", "id"],
  },
  {
    paramPattern: /^(?:migration_id)$/i,
    entityNames: ["migration", "repository_migration"],
    fieldNames: ["id", "migration_id", "guid"],
  },
  {
    paramPattern: /^(?:check_run_id)$/i,
    entityNames: ["check_run", "checks"],
    fieldNames: ["id", "check_run_id"],
  },
  {
    paramPattern: /^(?:check_suite_id)$/i,
    entityNames: ["check_suite", "checks"],
    fieldNames: ["id", "check_suite_id"],
  },
  {
    paramPattern: /^(?:discussion_number|discussion_id)$/i,
    entityNames: ["discussion", "discussions"],
    fieldNames: ["number", "discussion_number", "id"],
  },
  {
    paramPattern: /^(?:project_id|project_number)$/i,
    entityNames: ["project", "projects"],
    fieldNames: ["id", "number", "project_id"],
  },
  {
    paramPattern: /^(?:column_id)$/i,
    entityNames: ["column", "project_column"],
    fieldNames: ["id", "column_id"],
  },
  {
    paramPattern: /^(?:card_id)$/i,
    entityNames: ["card", "project_card"],
    fieldNames: ["id", "card_id"],
  },
  {
    paramPattern: /^(?:tree_sha)$/i,
    entityNames: ["tree", "git_tree"],
    fieldNames: ["sha", "tree_sha"],
  },
  {
    paramPattern: /^(?:commit_sha|sha|head_sha|base_sha)$/i,
    entityNames: ["commit", "commits", "git"],
    fieldNames: ["sha", "commit_sha", "node_id"],
  },
  {
    paramPattern: /^(?:branch|branch_name|base|head)$/i,
    entityNames: ["branch", "branches", "ref"],
    fieldNames: ["name", "ref", "branch"],
  },
  {
    paramPattern: /^(?:tag_name|tag)$/i,
    entityNames: ["tag", "tags", "release"],
    fieldNames: ["name", "tag_name", "tag"],
  },
];

export class DependencyMatcher {
  private tools: ParsedTool[];
  private toolBySlug: Map<string, ParsedTool>;
  private toolByName: Map<string, ParsedTool>;
  private normalizedNameToTool: Map<string, ParsedTool>;

  constructor(tools: ParsedTool[]) {
    this.tools = tools;
    this.toolBySlug = new Map(tools.map((t) => [t.slug, t]));
    this.toolByName = new Map(tools.map((t) => [t.name, t]));
    this.normalizedNameToTool = new Map(
      tools.map((t) => [normalizeText(t.name), t])
    );
  }

  public discoverDependencies(): Edge[] {
    const edges: Edge[] = [];
    const edgeKeySet = new Set<string>();

    const addEdge = (from: string, to: string, label: string) => {
      if (!from || !to || from === to) return;
      // Ensure both slugs exist in the catalog (provenance guarantee)
      if (!this.toolBySlug.has(from) || !this.toolBySlug.has(to)) return;

      const key = `${from}|${to}|${label}`;
      if (!edgeKeySet.has(key)) {
        edgeKeySet.add(key);
        edges.push({ from, to, label });
      }
    };

    // Strategy 1: Explicit description references
    this.matchDescriptionReferences(addEdge);

    // Strategy 2: Schema & Entity Property Matching
    this.matchEntityProperties(addEdge);

    // Strategy 3: General Domain/Toolkit Heuristics (Generic fallback for any toolkit)
    this.matchGenericParameterEntities(addEdge);

    return edges;
  }

  /**
   * Scans parameter descriptions and tool descriptions for references to other tools.
   */
  private matchDescriptionReferences(addEdge: (from: string, to: string, label: string) => void) {
    for (const consumer of this.tools) {
      for (const param of consumer.inputParameters) {
        if (!param.description) continue;
        const text = param.description;

        // Pattern 1: using the 'Action Name' action
        const matches = text.matchAll(/(?:using|from|by|with)\s+(?:the\s+)?['"‘“]([^'"’”]+)['"’”]\s+(?:action|endpoint|tool|method)/gi);
        for (const match of matches) {
          const referencedName = match[1].trim();
          const targetTool = this.findToolByNameOrSlug(referencedName);
          if (targetTool) {
            addEdge(targetTool.slug, consumer.slug, param.name);
          }
        }

        // Pattern 2: returned (by|when) 'Action Name'
        const matches2 = text.matchAll(/(?:returned|generated|created|obtained)\s+(?:by|when|from)\s+['"‘“]([^'"’”]+)['"’”]/gi);
        for (const match of matches2) {
          const referencedName = match[1].trim();
          const targetTool = this.findToolByNameOrSlug(referencedName);
          if (targetTool) {
            addEdge(targetTool.slug, consumer.slug, param.name);
          }
        }

        // Pattern 3: direct slug reference e.g. GITHUB_LIST_REPOSITORY_ISSUES
        for (const producer of this.tools) {
          if (producer.slug === consumer.slug) continue;
          if (text.includes(producer.slug)) {
            addEdge(producer.slug, consumer.slug, param.name);
          }
        }
      }
    }
  }

  private findToolByNameOrSlug(name: string): ParsedTool | undefined {
    if (this.toolBySlug.has(name)) return this.toolBySlug.get(name);
    if (this.toolByName.has(name)) return this.toolByName.get(name);

    const norm = normalizeText(name);
    if (this.normalizedNameToTool.has(norm)) return this.normalizedNameToTool.get(norm);

    // Partial search
    for (const [n, tool] of this.normalizedNameToTool.entries()) {
      if (n.includes(norm) || norm.includes(n)) {
        return tool;
      }
    }
    return undefined;
  }

  /**
   * Matches entity-id input parameters with tools producing those entities.
   */
  private matchEntityProperties(addEdge: (from: string, to: string, label: string) => void) {
    for (const consumer of this.tools) {
      for (const param of consumer.inputParameters) {
        for (const rule of KNOWN_ENTITY_RULES) {
          if (rule.paramPattern.test(param.name)) {
            // Find all producers that create, list, search, or get this entity
            for (const producer of this.tools) {
              if (producer.slug === consumer.slug) continue;

              // Check if producer operates on one of the rule's entities
              const isEntityMatch = producer.targetEntities.some((e) =>
                rule.entityNames.some((re) => re === e || e.includes(re) || re.includes(e))
              );

              // Check if producer has output matching the field
              const hasOutputField =
                producer.outputProperties.has(param.name) ||
                rule.fieldNames.some((fn) => producer.outputProperties.has(fn));

              // Producers are typically LIST, SEARCH, CREATE, or GET
              const isProducerRole =
                producer.actionType === "LIST" ||
                producer.actionType === "SEARCH" ||
                producer.actionType === "CREATE" ||
                producer.actionType === "GET";

              // Check domain/service alignment if specialized
              const isServiceAligned =
                producer.service === consumer.service ||
                rule.entityNames.includes(producer.service) ||
                rule.entityNames.includes(consumer.service) ||
                producer.service === "general" ||
                consumer.service === "general";

              if (isEntityMatch && isProducerRole && (isServiceAligned || hasOutputField)) {
                addEdge(producer.slug, consumer.slug, param.name);
              }
            }
          }
        }
      }
    }
  }

  /**
   * Generic entity matcher for ANY toolkit:
   * Detects parameter suffixes `_id`, `_number`, `_key`, `_slug`, `_code`, `_token`
   * and links to producer tools that create/list/get that entity.
   */
  private matchGenericParameterEntities(addEdge: (from: string, to: string, label: string) => void) {
    for (const consumer of this.tools) {
      for (const param of consumer.inputParameters) {
        // e.g. "order_id" -> entity "order", "customer_key" -> entity "customer"
        const match = param.name.match(/^([a-z0-9_]+)_(id|number|key|slug|code|name|token)$/i);
        if (!match) continue;

        const entityPrefix = match[1].toLowerCase();
        // Skip overly generic words
        if (entityPrefix === "client" || entityPrefix === "account" || entityPrefix === "app") {
          continue;
        }

        for (const producer of this.tools) {
          if (producer.slug === consumer.slug) continue;

          // Check if producer is LIST/SEARCH/CREATE/GET for this entityPrefix
          const producesEntity = producer.targetEntities.some(
            (e) => e === entityPrefix || e.includes(entityPrefix) || entityPrefix.includes(e)
          );

          if (producesEntity) {
            if (
              producer.actionType === "LIST" ||
              producer.actionType === "SEARCH" ||
              producer.actionType === "CREATE" ||
              producer.actionType === "GET"
            ) {
              addEdge(producer.slug, consumer.slug, param.name);
            }
          } else if (producer.outputProperties.has(param.name)) {
            // Producer explicitly outputs this exact parameter name
            addEdge(producer.slug, consumer.slug, param.name);
          }
        }
      }
    }
  }
}
