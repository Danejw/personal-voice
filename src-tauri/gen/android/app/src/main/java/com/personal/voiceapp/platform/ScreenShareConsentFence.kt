package com.personal.voiceapp.platform

/**
 * One-way screen-capture permission generation. A late Android consent result or foreground
 * service intent must never revive a stream that the user already stopped.
 */
internal class ScreenShareConsentFence {
  private var generation = 0L

  @Synchronized fun begin(): Long {
    generation += 1
    return generation
  }

  @Synchronized fun isCurrent(request: Long): Boolean =
    request > 0 && request == generation

  @Synchronized fun revoke() {
    generation += 1
  }
}
