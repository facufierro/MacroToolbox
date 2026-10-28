import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { getOverlayItemPosition } from "../src/overlayPosition.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const browser = [
  join(process.env.PROGRAMFILES ?? "", "Google/Chrome/Application/chrome.exe"),
  join(process.env["PROGRAMFILES(X86)"] ?? "", "Microsoft/Edge/Application/msedge.exe"),
].find(existsSync);

// Evaluate the real part components in memory, without building the app or invoking Tauri.
const require = createRequire(import.meta.url);
const exports = {};
runInNewContext(ts.transpileModule(readFileSync(join(root, "src/OverlayParts.tsx"), "utf8"), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports, require(specifier) {
  if (specifier.endsWith(".css")) return {};
  if (specifier === "./overlayPosition") return { getOverlayItemPosition };
  return require(specifier);
} });
const { OverlayGroupView, OverlayItemView } = exports;

const origin = [100, 50, 1200, 800];
const icon = { id: "icon", type: "icon", x: 0, y: 0, w: 32, h: 32,
  src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Crect width='32' height='32' fill='blue'/%3E%3C/svg%3E" };
const timer = { id: "timer", type: "timer", x: 0, y: 0, duration_ms: 60000, font_size: 12, color: "#fff", show_background: false };
const bar = { id: "bar", type: "bar", x: 0, y: 0, w: 80, h: 96, max_value: 100, color: "#fff" };
const cases = [
  ["hp", "row", [icon], 8],
  ["magic", "column", [icon, timer], 0],
  ["background", "column", [icon, { ...timer, show_background: true }], 8],
  ["wide", "column", [icon, { ...timer, font_size: 48 }], 8],
  ["hidden-timer", "column", [icon], 0],
  ["horizontal", "row", [icon, bar], 8],
  ["three", "column", [icon, timer, bar], 8],
  ["free", "free", [{ ...icon, x: 5, y: 10 }, timer], 8],
];

test("overlay layout anchors its first part while centering larger neighbors", { skip: !browser && "Chrome or Edge is required for layout checks" }, async t => {
  const markup = cases.map(([name, layout, parts, gap]) => renderToStaticMarkup(
    h("section", { "data-case": name }, h(OverlayGroupView, { group: { id: name, x: 25, y: 12.5, layout, gap }, origin },
      parts.map(item => h(OverlayItemView, { key: item.id, item, origin: [0, 0, 1200, 800],
        flow: layout !== "free", remainingMs: 57000, onMount() {} })))),
  )).join("");
  const css = ["src/App.css", "src/overlayParts.css"].map(file => readFileSync(join(root, file), "utf8")).join("\n");
  const measure = () => {
    const rect = el => {
      const { left, top, width, height } = el.getBoundingClientRect();
      return { left, top, width, height };
    };
    const results = Object.fromEntries([...document.querySelectorAll("[data-case]")].map(section => [section.dataset.case,
      Object.fromEntries(["img", ".ov-timer", ".ov-bar"].flatMap(selector => {
        const el = section.querySelector(selector);
        return el ? [[selector, { ...rect(el), hitbox: rect(el.parentElement) }]] : [];
      })),
    ]));
    document.getElementById("results").textContent = JSON.stringify(results);
  };
  const logs = resolve(root, "logs");
  mkdirSync(logs, { recursive: true });
  const directory = mkdtempSync(join(logs, "overlay-layout-"));
  let measured;
  try {
    const page = join(directory, "layout.html");
    writeFileSync(page, `<!doctype html><style>${css}</style>${markup}<pre id="results"></pre><script>(${measure})();</script>`);
    const output = execFileSync(browser, ["--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
      `--user-data-dir=${join(directory, "profile")}`, "--dump-dom", pathToFileURL(page).href],
    { encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"] });
    const result = output.match(/<pre id="results">([^<]+)<\/pre>/);
    assert.ok(result, "browser did not return layout measurements");
    measured = JSON.parse(result[1]);
  } finally {
    assert.equal(dirname(directory), logs);
    rmSync(directory, { recursive: true, force: true });
  }

  await t.test("matching icons stay at the same coordinates with or without a wider timer", () => {
    for (const name of ["hp", "magic", "background", "wide", "hidden-timer", "three"]) {
      assert.deepEqual(measured[name].img, { left: 400, top: 150, width: 32, height: 32,
        hitbox: { left: 400, top: 150, width: 32, height: 32 } }, name);
    }
  });
  await t.test("timers remain centered with the configured gap and correct hitboxes", () => {
    for (const [name, gap] of [["magic", 0], ["background", 8], ["wide", 8], ["three", 8]]) {
      const clock = measured[name][".ov-timer"];
      assert.equal(clock.left + clock.width / 2, 416, name);
      assert.equal(clock.top, 182 + gap, name);
      assert.deepEqual(clock.hitbox, { left: clock.left, top: clock.top, width: clock.width, height: clock.height }, name);
    }
    const clock = measured.three[".ov-timer"], meter = measured.three[".ov-bar"];
    assert.equal(meter.left + meter.width / 2, 416);
    assert.equal(meter.top, clock.top + clock.height + 8);
  });
  await t.test("a taller horizontal neighbor does not move the first part vertically", () => {
    const first = measured.horizontal.img, meter = measured.horizontal[".ov-bar"];
    assert.equal(first.left, 400);
    assert.equal(first.top, 150);
    assert.equal(meter.left, 440);
    assert.equal(meter.top + meter.height / 2, 166);
    assert.deepEqual(meter.hitbox, { left: meter.left, top: meter.top, width: meter.width, height: meter.height });
  });
  await t.test("individual part positions retain their offsets", () => {
    assert.equal(measured.free.img.left, 460);
    assert.equal(measured.free.img.top, 230);
    assert.equal(measured.free[".ov-timer"].left, 400);
    assert.equal(measured.free[".ov-timer"].top, 150);
  });
});
