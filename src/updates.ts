export interface AvailableUpdate {
  version: string;
  downloadUrl: string | null;
  notesUrl: string;
}

export function semverGt(a: string, b: string): boolean {
  const parse = (version: string) => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version)?.slice(1).map(Number);
  const left = parse(a), right = parse(b);
  if (!left || !right) return false;
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return false;
}

export async function findUpdate(current: string, fetchRelease: typeof fetch = fetch): Promise<AvailableUpdate | null> {
  const response = await fetchRelease("https://api.github.com/repos/facufierro/MacroToolbox/releases/latest");
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Could not check for updates (HTTP ${response.status}).`);
  const data = await response.json();
  const latest = typeof data.tag_name === "string" ? data.tag_name : "";
  if (!semverGt(latest, current)) return null;
  const assets: { name: string; browser_download_url: string }[] = Array.isArray(data.assets) ? data.assets : [];
  const installer = assets.find(asset => asset.name?.endsWith("-setup.exe")) ?? assets.find(asset => asset.name?.endsWith(".exe"));
  return { version: latest, downloadUrl: installer?.browser_download_url ?? null, notesUrl: data.html_url };
}
