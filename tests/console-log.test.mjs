import assert from "node:assert/strict";
import test from "node:test";
import { captureWindowErrors, consoleReducer, consoleText, EMPTY_CONSOLE, errorMessage } from "../src/consoleLog.ts";

const failure = (message = "Overlay part is unavailable.", source = "Runtime", at = 1000) => ({ type: "error", message, source, at });

test("a new error opens the console and retains the time and source", () => {
  const state = consoleReducer(EMPTY_CONSOLE, failure());
  assert.equal(state.expanded, true);
  assert.deepEqual(state.entries, [{ id: 1, source: "Runtime", message: failure().message, firstAt: 1000, lastAt: 1000, count: 1 }]);
  assert.deepEqual(EMPTY_CONSOLE.entries, []);
});

test("repeated errors accumulate without reopening a console the user collapsed", () => {
  const first = consoleReducer(EMPTY_CONSOLE, failure());
  const collapsed = consoleReducer(first, { type: "toggle" });
  const repeated = consoleReducer(collapsed, failure(undefined, undefined, 2000));
  assert.equal(repeated.expanded, false);
  assert.equal(repeated.entries.length, 1);
  assert.equal(repeated.entries[0].firstAt, 1000);
  assert.equal(repeated.entries[0].lastAt, 2000);
  assert.equal(repeated.entries[0].count, 2);
  assert.equal(first.entries[0].count, 1);
});

test("errors from distinct sources remain distinct and a different failure reopens the console", () => {
  let state = consoleReducer(EMPTY_CONSOLE, failure());
  state = consoleReducer(state, { type: "toggle" });
  state = consoleReducer(state, failure(undefined, "Overlay"));
  assert.equal(state.expanded, true);
  assert.deepEqual(state.entries.map(entry => entry.source), ["Runtime", "Overlay"]);
  state = consoleReducer(state, failure("Another failure", "Overlay"));
  assert.equal(state.entries.length, 3);
});

test("clear empties the copied log and a subsequent failure is reported normally", () => {
  const first = consoleReducer(EMPTY_CONSOLE, failure());
  const cleared = consoleReducer(first, { type: "clear" });
  assert.equal(consoleText(cleared.entries), "");
  const next = consoleReducer(cleared, failure());
  assert.equal(next.entries[0].id, 2);
  assert.equal(next.entries[0].count, 1);
});

test("copy includes messages, source, timestamps and repetition details", () => {
  const state = consoleReducer(consoleReducer(EMPTY_CONSOLE, failure()), failure(undefined, undefined, 2000));
  assert.equal(consoleText(state.entries), "[1970-01-01T00:00:01.000Z] Runtime: Overlay part is unavailable. (2 times; last 1970-01-01T00:00:02.000Z)");
});

test("error formatting preserves stacks, backend strings and structured rejections", () => {
  const error = new Error("failed");
  assert.equal(errorMessage(error), error.stack);
  assert.equal(errorMessage("backend failed"), "backend failed");
  assert.equal(errorMessage({ message: "failed", code: 3 }), '{"message":"failed","code":3}');
  const circular = {}; circular.self = circular;
  assert.equal(errorMessage(circular), "[object Object]");
  assert.equal(errorMessage(undefined), "undefined");
});

test("uncaught errors and rejected async operations are captured and listeners are removed", () => {
  const target = new EventTarget();
  const messages = [];
  const stop = captureWindowErrors(target, value => messages.push(errorMessage(value)));
  const error = new Event("error");
  Object.assign(error, { error: new Error("render failed") });
  target.dispatchEvent(error);
  const fallback = new Event("error");
  Object.assign(fallback, { message: "script failed", filename: "app.js", lineno: 2, colno: 3 });
  target.dispatchEvent(fallback);
  const rejection = new Event("unhandledrejection");
  Object.assign(rejection, { reason: "async failed" });
  target.dispatchEvent(rejection);
  assert.match(messages[0], /render failed/);
  assert.equal(messages[1], "script failed (app.js:2:3)");
  assert.equal(messages[2], "async failed");
  stop(); target.dispatchEvent(error); target.dispatchEvent(rejection);
  assert.equal(messages.length, 3);
});
