/**
 * Web build: AdMob has no web SDK, and the package imports React Native
 * internals react-native-web doesn't ship. Every ad surface checks `sdk` and
 * renders nothing when it is null. The native build is sdk.native.ts.
 */
export type AdsSdk = typeof import("react-native-google-mobile-ads");

const sdk: AdsSdk | null = null;
export default sdk;

export async function requestTrackingIfNeeded(): Promise<{ asked: boolean; granted: boolean }> {
  return { asked: false, granted: false };
}
