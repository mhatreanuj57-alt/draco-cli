'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

class ConfigManager {
  constructor(options = {}) {
    this.configDir = options.configDir || path.join(os.homedir(), '.draco');
    this.configFile = path.join(this.configDir, 'config.json');
    this.config = {};
    this.watchers = new Map();
    this.defaults = {};
  }

  setDefaults(defaults) {
    this.defaults = { ...defaults };
    return this;
  }

  load() {
    try {
      if (!fs.existsSync(this.configDir)) {
        fs.mkdirSync(this.configDir, { recursive: true });
      }

      if (fs.existsSync(this.configFile)) {
        const data = fs.readFileSync(this.configFile, 'utf8');
        this.config = JSON.parse(data);
      }
    } catch (error) {
      console.error(`Failed to load config: ${error.message}`);
      this.config = {};
    }

    return this;
  }

  save() {
    try {
      if (!fs.existsSync(this.configDir)) {
        fs.mkdirSync(this.configDir, { recursive: true });
      }

      fs.writeFileSync(this.configFile, JSON.stringify(this.config, null, 2));
      this.notifyWatchers();
    } catch (error) {
      console.error(`Failed to save config: ${error.message}`);
    }

    return this;
  }

  get(key, defaultValue = undefined) {
    const keys = key.split('.');
    let value = this.config;

    for (const k of keys) {
      if (value === null || value === undefined) {
        return this.getDefaults(key, defaultValue);
      }
      value = value[k];
    }

    return value !== undefined ? value : this.getDefaults(key, defaultValue);
  }

  getDefaults(key, defaultValue) {
    const keys = key.split('.');
    let value = this.defaults;

    for (const k of keys) {
      if (value === null || value === undefined) {
        return defaultValue;
      }
      value = value[k];
    }

    return value !== undefined ? value : defaultValue;
  }

  set(key, value) {
    const keys = key.split('.');
    let current = this.config;

    for (let i = 0; i < keys.length - 1; i++) {
      if (!(keys[i] in current) || typeof current[keys[i]] !== 'object') {
        current[keys[i]] = {};
      }
      current = current[keys[i]];
    }

    current[keys[keys.length - 1]] = value;
    this.save();

    return this;
  }

  delete(key) {
    const keys = key.split('.');
    let current = this.config;

    for (let i = 0; i < keys.length - 1; i++) {
      if (!(keys[i] in current)) return false;
      current = current[keys[i]];
    }

    const deleted = delete current[keys[keys.length - 1]];
    if (deleted) this.save();

    return deleted;
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  getAll() {
    return { ...this.config };
  }

  merge(otherConfig) {
    this.config = this.deepMerge(this.config, otherConfig);
    this.save();
    return this;
  }

  deepMerge(target, source) {
    const result = { ...target };

    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(result[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }

    return result;
  }

  watch(key, callback) {
    if (!this.watchers.has(key)) {
      this.watchers.set(key, []);
    }
    this.watchers.get(key).push(callback);

    return () => {
      const callbacks = this.watchers.get(key);
      if (callbacks) {
        const index = callbacks.indexOf(callback);
        if (index !== -1) callbacks.splice(index, 1);
      }
    };
  }

  notifyWatchers() {
    for (const [key, callbacks] of this.watchers) {
      const value = this.get(key);
      for (const callback of callbacks) {
        callback(value);
      }
    }
  }

  reset() {
    this.config = {};
    this.save();
    return this;
  }
}

module.exports = { ConfigManager };
