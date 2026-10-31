import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const browser = [join(process.env.PROGRAMFILES ?? "", "Google/Chrome/Application/chrome.exe"),
  join(process.env["PROGRAMFILES(X86)"] ?? "", "Microsoft/Edge/Application/msedge.exe")].find(existsSync);

// Load actual production React components without an app build or server.
export function browserModules(entries, { mocks = ["./api", "./AppConsole"], expose = {} } = {}) {
  const modules = new Map();
  function collect(file) {
    if (modules.has(file)) return file;
    let code = readFileSync(file, "utf8");
    if (expose[file]) code += `\nexport { ${expose[file].join(", ")} };`;
    if (/\.tsx?$/.test(file)) code = ts.transpileModule(code, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const dependencies = {};
    modules.set(file, { code, dependencies });
    const require = createRequire(file);
    for (const [, name] of code.matchAll(/\brequire\(["']([^"']+)["']\)/g)) {
      if (mocks.includes(name)) { dependencies[name] = name; continue; }
      if (name.includes(".development.")) continue;
      const local = resolve(dirname(file), name);
      const target = name.startsWith(".") && [local, local + ".tsx", local + ".ts"].find(existsSync);
      dependencies[name] = collect(target || require.resolve(name));
    }
    return file;
  }
  const entry = collect(join(root, "src", entries[0]));
  for (const name of entries.slice(1)) collect(join(root, "src", name));
  collect(createRequire(import.meta.url).resolve("react-dom/client"));
  const declarations = [...modules].map(([id, { code, dependencies }]) => `${JSON.stringify(id)}:[function(module,exports,require,process){\n${code}\n},${JSON.stringify(dependencies)}]`).join(",\n");
  return { entry, declarations, react: createRequire(import.meta.url).resolve("react"), client: createRequire(import.meta.url).resolve("react-dom/client") };
}
