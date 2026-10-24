'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const theme = require('../ui/theme.js');

class Logger {
  constructor(options = {}) {
    this.level = options.level || 'info';
    this.logDir = options.logDir || path.join(os.homedir(), '.draco', 'logs');
    this.maxFileSize = options.maxFileSize || 5 * 1024 * 1024;
    this.maxFiles = options.maxFiles || 5;
    this.console = options.console !== false;
    this.file = options.file !== false;

    this.levels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3,
      trace: 4,
    };

    this.colors = {
      error: '\x1b[31m',
      warn: '\x1b[33m',
      info: '\x1b[36m',
      debug: '\x1b[35m',
      trace: '\x1b[90m',
      reset: '\x1b[0m',
    };

    if (this.file) {
      try {
        if (!fs.existsSync(this.logDir)) {
          fs.mkdirSync(this.logDir, { recursive: true });
        }
      } catch (err) {
        theme.printError(`Failed to create log directory: ${err.message}`);
        this.file = false;
      }
    }
  }

  shouldLog(level) {
    return this.levels[level] <= this.levels[this.level];
  }

  formatMessage(level, message, data) {
    const timestamp = new Date().toISOString();
    let formatted = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

    if (data !== undefined) {
      if (data instanceof Error) {
        formatted += `\n${data.stack || data.message}`;
      } else if (typeof data === 'object') {
        formatted += `\n${JSON.stringify(data, null, 2)}`;
      } else {
        formatted += ` ${data}`;
      }
    }

    return formatted;
  }

  writeToFile(level, message) {
    if (!this.file) return;

    try {
      const logFile = path.join(this.logDir, `${level}.log`);
      const formatted = this.formatMessage(level, message);

      fs.appendFileSync(logFile, formatted + '\n');

      const stats = fs.statSync(logFile);
      if (stats.size > this.maxFileSize) {
        this.rotateFile(logFile);
      }
    } catch (error) {
      theme.printError(`Failed to write to log file: ${error.message}`);
    }
  }

  rotateFile(filePath) {
    try {
      for (let i = this.maxFiles - 1; i > 0; i--) {
        const oldFile = `${filePath}.${i}`;
        const newFile = `${filePath}.${i + 1}`;

        if (fs.existsSync(oldFile)) {
          if (i === this.maxFiles - 1) {
            fs.unlinkSync(oldFile);
          } else {
            fs.renameSync(oldFile, newFile);
          }
        }
      }

      if (fs.existsSync(filePath)) {
        fs.renameSync(filePath, `${filePath}.1`);
      }
    } catch (error) {
      theme.printError(`Failed to rotate log file: ${error.message}`);
    }
  }

  log(level, message, data) {
    if (!this.shouldLog(level)) return;

    const formatted = this.formatMessage(level, message, data);

    if (this.console) {
      if (level === 'error') {
        console.error(theme.errorTag(formatted));
      } else {
        const color = this.colors[level] || '';
        console.log(`${color}${formatted}${this.colors.reset}`);
      }
    }

    this.writeToFile(level, formatted);
  }

  error(message, data) {
    this.log('error', message, data);
  }

  warn(message, data) {
    this.log('warn', message, data);
  }

  info(message, data) {
    this.log('info', message, data);
  }

  debug(message, data) {
    this.log('debug', message, data);
  }

  trace(message, data) {
    this.log('trace', message, data);
  }

  setLevel(level) {
    if (this.levels[level] === undefined) {
      throw new Error(`Invalid log level: ${level}. Must be one of: ${Object.keys(this.levels).join(', ')}`);
    }
    this.level = level;
  }

  getLevel() {
    return this.level;
  }

  getRecentLogs(level = 'info', lines = 50) {
    if (!this.file) return [];
    try {
      const logFile = path.join(this.logDir, `${level}.log`);
      if (!fs.existsSync(logFile)) return [];
      const content = fs.readFileSync(logFile, 'utf8');
      const allLines = content.split('\n').filter(Boolean);
      return allLines.slice(-lines);
    } catch (err) {
      return [];
    }
  }

  child(options = {}) {
    return new Logger({
      ...this,
      ...options,
    });
  }

  clearLogs() {
    if (!this.file) return false;
    try {
      const files = fs.readdirSync(this.logDir);
      for (const file of files) {
        if (file.endsWith('.log')) {
          fs.unlinkSync(path.join(this.logDir, file));
        }
      }
      return true;
    } catch (error) {
      theme.printError(`Failed to clear logs: ${error.message}`);
      return false;
    }
  }

  getLogSize(level = 'info') {
    if (!this.file) return 0;
    try {
      const logFile = path.join(this.logDir, `${level}.log`);
      if (!fs.existsSync(logFile)) return 0;
      const stats = fs.statSync(logFile);
      return stats.size;
    } catch (error) {
      return 0;
    }
  }
}

const logger = new Logger();

module.exports = { Logger, logger };
