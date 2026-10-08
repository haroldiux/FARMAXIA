/** Whether the plan snapshot shows the feature enabled; an unknown snapshot does not hide anything (the API still enforces it). */
export function planAllows(features: Array<{ code: string; enabled: boolean }> | undefined, code: string): boolean {
  if (!features) return true;
  return features.some((feature) => feature.code === code && feature.enabled);
}
