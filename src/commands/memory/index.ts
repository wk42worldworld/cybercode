import type { Command } from '../../commands.js'

const memory: Command = {
  type: 'local-jsx',
  name: 'memory',
  description: 'Manage CyberCode prompt memory and instruction files',
  argumentHint:
    'status | edit soul|brief|user | add brief|user <entry> | remove brief|user <text>',
  load: () => import('./memory.js'),
}

export default memory
