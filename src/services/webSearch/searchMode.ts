import { getAuthTokenSource, getApiKeyFromConfigOrMacOSKeychain } from '../../utils/auth.js'
import { getApiKeyFromFileDescriptor } from '../../utils/authFileDescriptor.js'
import { getAPIProvider } from '../../utils/model/providers.js'

/** Only a fresh, unconfigured installation changes its search backend. */
export function shouldUseParallelWebSearch(): boolean {
  const mode = process.env.CYBERCODE_WEB_SEARCH_MODE?.trim().toLowerCase()
  if (mode) return mode === 'parallel'

  // Startup projects saved provider settings into these same environment values.
  if (process.env.ANTHROPIC_BASE_URL || getAPIProvider() !== 'firstParty') {
    return false
  }

  // Inspect credential sources without executing an apiKeyHelper. Preserve even
  // an unapproved env key: configuring a credential is an intentional choice.
  return !(
    process.env.ANTHROPIC_API_KEY ||
    getAuthTokenSource().hasToken ||
    getApiKeyFromFileDescriptor() ||
    getApiKeyFromConfigOrMacOSKeychain()?.key
  )
}
