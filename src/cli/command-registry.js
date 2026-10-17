'use strict';

const { SlashCommand } = require('./slash-commands');

class CommandRegistry {
  constructor() {
    this.commands = new Map();
    this.aliases = new Map();
    this.groups = new Map();
  }

  register(command) {
    if (!(command instanceof SlashCommand)) {
      throw new Error('Command must be an instance of SlashCommand');
    }

    this.commands.set(command.name, command);

    for (const alias of command.aliases) {
      this.aliases.set(alias, command.name);
    }

    const group = command.group || 'General';
    if (!this.groups.has(group)) {
      this.groups.set(group, []);
    }
    this.groups.get(group).push(command.name);

    return this;
  }

  unregister(name) {
    const command = this.commands.get(name) || this.getCommand(this.aliases.get(name));
    if (!command) return false;

    this.commands.delete(command.name);
    for (const alias of command.aliases) {
      this.aliases.delete(alias);
    }

    const group = this.groups.get(command.group);
    if (group) {
      const idx = group.indexOf(command.name);
      if (idx !== -1) group.splice(idx, 1);
    }

    return true;
  }

  getCommand(name) {
    if (!name) return null;
    const resolvedName = this.aliases.get(name) || name;
    return this.commands.get(resolvedName) || null;
  }

  async execute(name, args, context) {
    const command = this.getCommand(name);
    if (!command) {
      return { success: false, error: `Unknown command: ${name}` };
    }

    try {
      if (command.middleware && command.middleware.length > 0) {
        for (const middleware of command.middleware) {
          const result = await middleware(args, context);
          if (result === false) {
            return { success: false, error: 'Middleware rejected command' };
          }
        }
      }

      const result = await command.execute(args, context);
      return { success: true, result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  listCommands() {
    const commands = [];
    for (const [name, command] of this.commands) {
      commands.push({
        name,
        description: command.description,
        group: command.group,
        aliases: command.aliases,
        usage: command.usage,
      });
    }
    return commands;
  }

  listByGroup() {
    const grouped = {};
    for (const [group, commandNames] of this.groups) {
      grouped[group] = commandNames.map((name) => {
        const cmd = this.commands.get(name);
        return {
          name,
          description: cmd.description,
          usage: cmd.usage,
        };
      });
    }
    return grouped;
  }

  findCommands(query) {
    const results = [];
    const lowerQuery = query.toLowerCase();

    for (const [name, command] of this.commands) {
      if (
        name.toLowerCase().includes(lowerQuery) ||
        command.description.toLowerCase().includes(lowerQuery)
      ) {
        results.push({
          name,
          description: command.description,
          group: command.group,
          usage: command.usage,
        });
      }
    }

    return results;
  }
}

module.exports = { CommandRegistry };
