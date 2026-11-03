import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("local builds retain the development release until a tag or committed archive releases it", () => {
  const root = fileURLToPath(new URL("../", import.meta.url)), logs = join(root, "logs");
  mkdirSync(logs, { recursive: true });
  const fixture = mkdtempSync(join(logs, "release-version-"));
  try {
    const script = join(fixture, "verify.ps1");
    writeFileSync(script, `param($ProjectPath, $FixturePath)
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $ProjectPath 'scripts/package-release.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw $errors[0] }
# Evaluate only the production version-selection block; packaging must never run here.
$selection = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.IfStatementAst] -and $node.Extent.Text.StartsWith('if (-not $gitTag)') }, $true)
if (-not $selection) { throw 'Version selection block not found.' }
$resolve = [scriptblock]::Create($selection.Extent.Text)
function git {
  if ($args[0] -eq 'tag') { return $script:fixtureTags }
  if ($args[0] -eq 'ls-tree') { return $script:fixtureArchives }
  throw 'Unexpected git command.'
}
function Check-Version($tags, $archives, $requested = '') {
  $repoRoot = $FixturePath; $gitTag = $requested
  $script:fixtureTags = $tags; $script:fixtureArchives = $archives
  . $resolve
  [pscustomobject]@{ tag = $gitTag; released = @($changelogs | Where-Object IsReleased | ForEach-Object Tag) }
}
New-Item -ItemType Directory -Path (Join-Path $FixturePath 'changelog'), (Join-Path $FixturePath 'releases/v6.4.0') -Force | Out-Null
Set-Content (Join-Path $FixturePath 'changelog/v6.3.2.md') 'Previous release'
Set-Content (Join-Path $FixturePath 'changelog/v6.4.0.md') 'Current development release'
$local = Check-Version @('v6.3.2') @('v6.3.2')
$tagged = Check-Version @('v6.3.2', 'v6.4.0') @('v6.3.2')
$archived = Check-Version @('v6.3.2') @('v6.3.2', 'v6.4.0')
Set-Content (Join-Path $FixturePath 'changelog/v6.5.0.md') 'Next development release'
$next = Check-Version @('v6.3.2', 'v6.4.0') @('v6.3.2')
$explicit = Check-Version @('v6.3.2') @('v6.3.2') 'v6.4.0'
@{local=$local;tagged=$tagged;archived=$archived;next=$next;explicit=$explicit} | ConvertTo-Json -Depth 5 -Compress
`);
    const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-ProjectPath", root, "-FixturePath", fixture], { encoding: "utf8", timeout: 15000 });
    const result = JSON.parse(output.trim().split(/\r?\n/).at(-1));
    assert.equal(result.local.tag, "v6.4.0");
    assert.deepEqual(result.local.released, ["v6.3.2"]);
    for (const state of ["tagged", "archived"]) {
      assert.equal(result[state].tag, "v6.4.0");
      assert.ok(result[state].released.includes("v6.4.0"));
    }
    assert.equal(result.next.tag, "v6.5.0");
    assert.equal(result.explicit.tag, "v6.4.0");
  } finally {
    assert.equal(dirname(fixture), logs);
    rmSync(fixture, { recursive: true, force: true });
  }
});
