import type { Command } from '../../commands.js'

const provider = {
  type: 'local-jsx',
  name: 'provider',
  aliases: ['providers'],
  description: 'Configure or switch model providers',
  load: () => import('./provider.js'),
} satisfies Command

export default provider
