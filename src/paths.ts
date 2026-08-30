import path from "node:path";

/** Canonical file/folder layout of an ontology directory. */
export function paths(root: string) {
  return {
    root,
    config: path.join(root, "ontology.config.yaml"),
    readme: path.join(root, "README.md"),
    typesDir: path.join(root, "types"),
    actionsDir: path.join(root, "actions"),
    connectionsDir: path.join(root, "connections"),
    connectorsDir: path.join(root, "connectors"),
    pipelinesDir: path.join(root, "pipelines"),
    dataDir: path.join(root, "data"),
    typeFile: (name: string) => path.join(root, "types", `${name}.md`),
    actionFile: (name: string) => path.join(root, "actions", `${name}.md`),
    connectionFile: (name: string) => path.join(root, "connections", `${name}.md`),
    connectorFile: (name: string) => path.join(root, "connectors", `${name}.md`),
    pipelineFile: (name: string) => path.join(root, "pipelines", `${name}.md`),
    instanceDir: (type: string) => path.join(root, "data", type),
    instanceFile: (type: string, id: string) => path.join(root, "data", type, `${id}.yaml`),
  };
}
