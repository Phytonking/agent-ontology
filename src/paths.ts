import path from "node:path";

export function paths(root: string) {
  return {
    root,
    config: path.join(root, "ontology.config.yaml"),
    connectorsDir: path.join(root, "connectors"),
    dataDir: path.join(root, "data"),
    objectFile: (name: string) => path.join(root, `${name}.md`),
    connectorFile: (name: string) => path.join(root, "connectors", `${name}.yaml`),
    instanceDir: (type: string) => path.join(root, "data", type),
    instanceFile: (type: string, id: string) => path.join(root, "data", type, `${id}.yaml`),
  };
}
