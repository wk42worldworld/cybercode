const version =
  process.env.CYBERCODE_LOCAL_VERSION ??
  process.env.CLAUDE_CODE_LOCAL_VERSION ??
  '999.0.0-local';
const packageUrl =
  process.env.CYBERCODE_LOCAL_PACKAGE_URL ??
  process.env.CLAUDE_CODE_LOCAL_PACKAGE_URL ??
  'cybercode-local';
const buildTime =
  process.env.CYBERCODE_LOCAL_BUILD_TIME ??
  process.env.CLAUDE_CODE_LOCAL_BUILD_TIME ??
  new Date().toISOString();
const skipRemotePrefetch =
  process.env.CYBERCODE_LOCAL_SKIP_REMOTE_PREFETCH ??
  process.env.CLAUDE_CODE_LOCAL_SKIP_REMOTE_PREFETCH ??
  '1';

process.env.CYBERCODE_LOCAL_SKIP_REMOTE_PREFETCH ??= skipRemotePrefetch;
// Keep the inherited variable populated for compatibility with internal modules.
process.env.CLAUDE_CODE_LOCAL_SKIP_REMOTE_PREFETCH ??= skipRemotePrefetch;

Object.assign(globalThis, {
  MACRO: {
    VERSION: version,
    PACKAGE_URL: packageUrl,
    NATIVE_PACKAGE_URL: packageUrl,
    BUILD_TIME: buildTime,
    FEEDBACK_CHANNEL: 'local',
    VERSION_CHANGELOG: '',
    ISSUES_EXPLAINER: '',
  },
});
// Switch to the current workspace
if (process.env.CALLER_DIR) {
  process.chdir(process.env.CALLER_DIR);
}
