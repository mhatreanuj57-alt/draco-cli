'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

class PluginManager {
  constructor(config) {
    this.config = config;
    this.plugins = new Map();
    this.hooks = new Map();
    this.pluginDir = path.join(os.homedir(), '.draco', 'plugins');
  }

  async loadPlugins() {
    if (!fs.existsSync(this.pluginDir)) {
      fs.mkdirSync(this.pluginDir, { recursive: true });
      return;
    }

    const pluginFiles = fs.readdirSync(this.pluginDir).filter((f) => f.endsWith('.js'));

    for (const file of pluginFiles) {
      try {
        await this.loadPlugin(path.join(this.pluginDir, file));
      } catch (error) {
        console.error(`Failed to load plugin ${file}: ${error.message}`);
      }
    }
  }

  async loadPlugin(pluginPath) {
    const pluginModule = require(pluginPath);
    const plugin = typeof pluginModule === 'function' ? pluginModule() : pluginModule;

    if (!plugin || !plugin.name) {
      throw new Error('Plugin must export a name');
    }

    const pluginInfo = {
      name: plugin.name,
      version: plugin.version || '1.0.0',
      description: plugin.description || '',
      author: plugin.author || '',
      hooks: plugin.hooks || {},
      commands: plugin.commands || [],
      initialized: false,
    };

    if (plugin.init) {
      await plugin.init(this.config);
      pluginInfo.initialized = true;
    }

    this.plugins.set(plugin.name, pluginInfo);

    for (const [hookName, hookFn] of Object.entries(pluginInfo.hooks)) {
      if (!this.hooks.has(hookName)) {
        this.hooks.set(hookName, []);
      }
      this.hooks.get(hookName).push({
        plugin: plugin.name,
        handler: hookFn,
      });
    }

    return pluginInfo;
  }

  async unloadPlugin(name) {
    const plugin = this.plugins.get(name);
    if (!plugin) return false;

    for (const [hookName, hookHandlers] of this.hooks) {
      const filtered = hookHandlers.filter((h) => h.plugin !== name);
      if (filtered.length === 0) {
        this.hooks.delete(hookName);
      } else {
        this.hooks.set(hookName, filtered);
      }
    }

    this.plugins.delete(name);
    return true;
  }

  async executeHook(hookName, data) {
    const handlers = this.hooks.get(hookName) || [];
    let result = data;

    for (const { plugin, handler } of handlers) {
      try {
        result = await handler(result);
      } catch (error) {
        console.error(`Hook ${hookName} failed in plugin ${plugin}: ${error.message}`);
      }
    }

    return result;
  }

  getPlugin(name) {
    return this.plugins.get(name);
  }

  listPlugins() {
    return Array.from(this.plugins.values());
  }

  hasPlugin(name) {
    return this.plugins.has(name);
  }

  async installPlugin(source) {
    const pluginName = path.basename(source, '.js');
    const destPath = path.join(this.pluginDir, `${pluginName}.js`);

    if (fs.existsSync(destPath)) {
      throw new Error(`Plugin ${pluginName} already exists`);
    }

    if (source.startsWith('http')) {
      const response = await fetch(source);
      const code = await response.text();
      fs.writeFileSync(destPath, code);
    } else {
      fs.copyFileSync(source, destPath);
    }

    return this.loadPlugin(destPath);
  }

  async uninstallPlugin(name) {
    const plugin = this.plugins.get(name);
    if (!plugin) return false;

    await this.unloadPlugin(name);

    const pluginPath = path.join(this.pluginDir, `${name}.js`);
    if (fs.existsSync(pluginPath)) {
      fs.unlinkSync(pluginPath);
    }

    return true;
  }
}

module.exports = { PluginManager };
