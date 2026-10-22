import assert from "node:assert/strict";
import test from "node:test";
import { allowsExtraModifiers } from "../src/hotkeyModifiers.ts";

test("unchecked hotkeys require their configured modifiers exactly", () => {
  for (const trigger of ["1", "x", "ctrl 1", "rctrl shift o"]) {
    assert.equal(allowsExtraModifiers({ trigger, allow_extra_modifiers: false }), false);
  }
});

test("checked hotkeys allow extra held modifiers", () => {
  for (const trigger of ["1", "x", "ctrl 1", "rctrl shift o"]) {
    assert.equal(allowsExtraModifiers({ trigger, allow_extra_modifiers: true }), true);
  }
});

test("old unmodified keyboard and mouse triggers keep accepting modifiers", () => {
  for (const trigger of ["1", "x", "LButton", "XButton1 y"]) {
    assert.equal(allowsExtraModifiers({ trigger }), true);
    assert.equal(allowsExtraModifiers({ trigger, allow_extra_modifiers: null }), true);
  }
});

test("old explicit modifier chords stay exact", () => {
  for (const modifier of ["ctrl", "shift", "alt", "win", "lctrl", "rctrl", "lshift", "rshift", "lalt", "ralt", "lwin", "rwin"]) {
    assert.equal(allowsExtraModifiers({ trigger: ` ${modifier.toUpperCase()}  1 ` }), false);
  }
});
