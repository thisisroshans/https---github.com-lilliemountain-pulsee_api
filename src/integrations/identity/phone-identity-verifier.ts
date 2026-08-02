/**
 * Phone identity verification, provider-agnostic.
 *
 * Phone ownership is proven client-side (currently by Firebase Phone Auth): the
 * app performs the SMS round trip and receives an ID token. The backend's only
 * job is to verify that token and learn which phone number it belongs to.
 *
 * Nothing outside `integrations/identity` may know the provider — swapping
 * Firebase for another identity provider should mean writing one new class.
 */

export interface VerifiedPhoneIdentity {
  /** Provider-side stable user id (Firebase uid). */
  providerUid: string;
  /** Verified phone number in E.164, e.g. "+919876543210". */
  phone: string;
  /** When the provider performed the sign-in, if it reports one. */
  authenticatedAt: Date | undefined;
}

export interface PhoneIdentityVerifier {
  /**
   * Verifies a provider-issued ID token.
   *
   * Implementations must reject expired, malformed, revoked, or wrong-audience
   * tokens, and must reject tokens that carry no verified phone number.
   *
   * @throws UnauthorizedError when the token is not valid.
   * @throws UpstreamError when the provider itself cannot be reached.
   */
  verifyIdToken(idToken: string): Promise<VerifiedPhoneIdentity>;
}
