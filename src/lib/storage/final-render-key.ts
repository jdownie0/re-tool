/**
 * Object key under bucket `renders`: `{userId}/{projectId}/final-{timestamp}.mp4`
 */
export function finalRenderStorageFilename(): string {
  return `final-${Date.now()}.mp4`;
}

export function finalRenderStorageObjectPath(
  userId: string,
  projectId: string,
): string {
  return `${userId}/${projectId}/${finalRenderStorageFilename()}`;
}
