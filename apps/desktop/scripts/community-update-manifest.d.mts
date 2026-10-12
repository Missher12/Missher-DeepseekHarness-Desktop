/** Public update metadata derived from the exact release assets. */
export interface CommunityUpdateManifest {
  version: string
  files: { url: string; sha512: string; size: number }[]
  path: string
  sha512: string
  releaseNotes: string
}
/** Hash the matching nonempty DEB and AppImage; reject invalid comparable versions or absent assets. */
export function createCommunityUpdateManifest(directory: string, version: string, notes: string): Promise<CommunityUpdateManifest>
