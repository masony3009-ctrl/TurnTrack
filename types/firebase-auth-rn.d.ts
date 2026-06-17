import type { Persistence } from "@firebase/auth";

// `getReactNativePersistence` exists in the React Native build of @firebase/auth
// but is omitted from the package's default (web) type entry, because the
// package's `exports` map lists a catch-all `types` ahead of its `react-native`
// condition. This augmentation declares the symbol for TypeScript; Metro still
// resolves the real React Native runtime implementation via the `react-native`
// export condition.
declare module "@firebase/auth" {
  export function getReactNativePersistence(storage: unknown): Persistence;
}
