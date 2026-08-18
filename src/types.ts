export interface ToolParameter {
  name: string;
  type?: string;
  description?: string;
  title?: string;
  required: boolean;
  examples?: any[];
}

export interface ToolOutputProperty {
  name: string;
  type?: string;
  description?: string;
  title?: string;
  entityName?: string;
}

export interface ParsedTool {
  slug: string;
  name: string;
  description: string;
  service: string;
  tags: string[];
  actionType: "LIST" | "SEARCH" | "GET" | "CREATE" | "UPDATE" | "DELETE" | "ACTION" | "OTHER";
  targetEntities: string[];
  inputParameters: ToolParameter[];
  requiredInputs: ToolParameter[];
  outputProperties: Map<string, ToolOutputProperty>;
  rawTool: Record<string, any>;
}

export interface Node {
  id: string;
  service?: string;
}

export interface Edge {
  from: string;
  to: string;
  label?: string;
}

export interface Graph {
  nodes: Node[];
  edges: Edge[];
}
