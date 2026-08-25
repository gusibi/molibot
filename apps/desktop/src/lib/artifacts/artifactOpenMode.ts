/**
 * Written files normally open as a Git diff. Renderable HTML is the exception:
 * a newly-created untracked page has no useful diff, while the Artifact viewer
 * can show the actual product immediately.
 */
export function shouldOpenArtifactAsDiff(path: string, mutates: boolean): boolean {
  return mutates && !/\.(?:html?|xhtml)$/i.test(path);
}
