import path from "node:path";

/** Canonical file/folder layout of an ontology directory. */
export function paths(root: string) {
  return {
    root,
    config: path.join(root, "ontology.config.yaml"),
    readme: path.join(root, "README.md"),
    typesDir: path.join(root, "types"),
    actionsDir: path.join(root, "actions"),
    typeFile: (name: string) => path.join(root, "types", `${name}.md`),
    actionFile: (name: string) => path.join(root, "actions", `${name}.md`),
  };
}
