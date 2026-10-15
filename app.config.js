// app.json holds the whole Expo config; this file only adds what can't live
// in a public repo.
//
// google-services.json gives Android its FCM sender, and without it Expo
// push tokens can't be minted on Android. It carries a Google API key, so it
// stays out of git (see .gitignore): EAS builds get it from the
// GOOGLE_SERVICES_JSON file variable (preview, production and development
// environments), and a local build falls back to a gitignored copy next to
// this file.
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? "./google-services.json",
  },
});
