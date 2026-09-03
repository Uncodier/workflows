"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("../config/config");
console.log("URL:", config_1.supabaseConfig.url);
console.log("Key:", config_1.supabaseConfig.key.substring(0, 20) + "...");
