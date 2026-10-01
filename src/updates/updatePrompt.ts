/** Whether to show the update toast for this available version. */
export function shouldOfferUpdateToast(
  autoUpdate: boolean,
  version: string,
  dismissedVersion: string | null,
): boolean {
  return !autoUpdate && dismissedVersion !== version;
}

/** Whether to start an automatic install for an available update. */
export function shouldAutoInstallUpdate(
  autoUpdate: boolean,
  busy: boolean,
  alreadyAttempted: boolean,
): boolean {
  return autoUpdate && !busy && !alreadyAttempted;
}
