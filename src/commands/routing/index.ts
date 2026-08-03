import type { Command } from '../../commands.js'

const routing = {
  type: 'local-jsx',
  name: 'routing',
  aliases: ['route'],
  description: 'Manage and use CyberCode agent routes',
  argumentHint: '[status|use|create|delete|enable|disable|strategy|on|off]',
  load: () => import('./routing.js'),
} satisfies Command

export default routing
