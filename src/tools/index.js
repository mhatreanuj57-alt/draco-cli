'use strict';

const { webFetch, webSearch } = require('./web-tools.js');

const FS_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'readFile',
      description:
        'Read a text file from the workspace into context. Large files are truncated.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative or absolute path inside the workspace.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'writeFile',
      description:
        'Create or overwrite a file in the workspace. Parent directories are created automatically.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative or absolute path inside the workspace.' },
          content: { type: 'string', description: 'Full file contents to write.' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'makeDirectory',
      description: 'Create a directory (and any missing parents) inside the workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path to create.' },
        },
        required: ['path'],
      },
    },
  },
];

const EXEC_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'executeShell',
      description:
        'Run a shell command in the workspace via the OS default shell. Requires user confirmation unless approval mode allows it. 45s timeout.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command line to run.' },
          cwd: { type: 'string', description: 'Optional working directory inside the workspace.' },
          shell: { type: 'string', description: 'Optional explicit shell binary override.' },
        },
        required: ['command'],
      },
    },
  },
];

const WEB_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'webFetch',
      description:
        'Fetch an http/https URL and return its content as cleaned plain text (or raw HTML with format="html"). Internal/private network targets are blocked.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The http(s) URL to fetch.' },
          format: { type: 'string', enum: ['text', 'html'], description: 'Response format. Defaults to text.' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'webSearch',
      description:
        'Search the public web and return the top results as title/url/snippet triples.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query.' },
        },
        required: ['query'],
      },
    },
  },
];

function buildToolDefs(mcpTools) {
  const defs = [...FS_TOOLS, ...EXEC_TOOLS, ...WEB_TOOLS];
  for (const tool of mcpTools || []) {
    defs.push({
      type: 'function',
      function: {
        name: tool.qualifiedName,
        description:
          (tool.description || `MCP tool from server "${tool.serverName}"`) +
          ` [MCP server: ${tool.serverName}]`,
        parameters: tool.inputSchema || { type: 'object', properties: {} },
      },
    });
  }
  return defs;
}

async function executeTool(name, args, ctx) {
  try {
    if (name.startsWith('mcp_')) {
      if (!ctx.mcp) return 'Error: MCP is not available in this session.';
      const text = await ctx.mcp.call(name, args);
      return text || '(tool returned no output)';
    }
    switch (name) {
      case 'readFile':
        return require('./fs-tools.js').readFile(ctx.workspaceRoot, args.path);
      case 'writeFile':
        return await require('./fs-tools.js').writeFile(ctx.workspaceRoot, args.path, args.content, ctx);
      case 'makeDirectory':
        return await require('./fs-tools.js').makeDirectory(ctx.workspaceRoot, args.path, ctx);
      case 'executeShell':
        return await require('./shell-tool.js').executeShell(args, ctx);
      case 'webFetch':
        return await webFetch(args);
      case 'webSearch':
        return await webSearch(args, ctx.cfg);
      default:
        return `Error: unknown tool "${name}".`;
    }
  } catch (e) {
    return `Error: ${e.message || e}`;
  }
}

module.exports = { buildToolDefs, executeTool };
