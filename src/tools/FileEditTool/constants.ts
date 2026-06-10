// In its own file to avoid circular dependencies
export const FILE_EDIT_TOOL_NAME = 'Edit'

// Permission pattern for granting session-level access to the project's .cyber/ folder
export const CLAUDE_FOLDER_PERMISSION_PATTERN = '/.cyber/**'

// Legacy project config permission pattern retained for existing .claude projects.
export const LEGACY_CLAUDE_FOLDER_PERMISSION_PATTERN = '/.claude/**'

// Permission pattern for granting session-level access to the global Cyber config folder
export const GLOBAL_CLAUDE_FOLDER_PERMISSION_PATTERN = '~/.cyber/**'

export const FILE_UNEXPECTEDLY_MODIFIED_ERROR =
  'File has been unexpectedly modified. Read it again before attempting to write it.'
