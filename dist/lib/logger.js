"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const config_1 = require("../config/config");
class Logger {
    level;
    constructor(level) {
        this.level = level;
    }
    formatMessage(message, data) {
        return {
            message,
            ...data,
        };
    }
    info(message, data) {
        if (this.level === 'debug' || this.level === 'info') {
            console.log(JSON.stringify(this.formatMessage(message, data)));
        }
    }
    error(message, data) {
        console.error(JSON.stringify(this.formatMessage(message, data)));
    }
    debug(message, data) {
        if (this.level === 'debug') {
            console.debug(JSON.stringify(this.formatMessage(message, data)));
        }
    }
    warn(message, data) {
        if (this.level === 'debug' || this.level === 'info' || this.level === 'warn') {
            console.warn(JSON.stringify(this.formatMessage(message, data)));
        }
    }
}
exports.logger = new Logger(config_1.logLevel);
