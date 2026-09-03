"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const apiService_1 = require("../temporal/services/apiService");
const dotenv = __importStar(require("dotenv"));
const path_1 = require("path");
const taskActivities_1 = require("../temporal/activities/taskActivities");
// Asegurarse de que las variables de entorno se carguen correctamente
dotenv.config({ path: (0, path_1.resolve)(process.cwd(), '.env') });
dotenv.config({ path: (0, path_1.resolve)(process.cwd(), '.env.local') });
async function sendTestEmails() {
    const email = 'sergio@uncodie.com';
    console.log(`Enviando correos de prueba a: ${email}...`);
    // Testing the specific Task 49f5a167-f140-40b8-a037-737d6590306e
    const realTask = {
        id: "49f5a167-f140-40b8-a037-737d6590306e",
        site_id: "9be0a6a2-5567-41bf-ad06-cb4014f0faf2",
        title: "Revisión de módulo de licitaciones",
        description: "{\"notes\":\"\",\"_calendar_context\":{\"origin\":\"reservations_modal\",\"catalog_item_id\":\"45d41ebf-682f-430a-8022-9b2f1cdffeb7\",\"catalog_item_name\":\"30 minute meeting\",\"duration\":\"30 min\",\"end_time\":\"2026-08-18T23:00:00.000Z\",\"location\":null}}",
        type: "meeting",
        status: "pending",
        stage: "consideration",
        scheduled_date: "2026-08-18 22:30:00+00",
        assignee: "541396e1-a904-4a81-8cbf-0ca4e3b8b2b4",
        lead_id: "4b495e86-75f7-4e18-b4e8-28b36e78127e",
        metadata: {
            "_calendar_context": {
                "origin": "reservations_modal",
                "duration": "30 min",
                "end_time": "2026-08-18T23:00:00.000Z",
                "location": "https://meet.google.com/sbh-esgz-wiv",
                "catalog_item_id": "45d41ebf-682f-430a-8022-9b2f1cdffeb7",
                "catalog_item_name": "30 minute meeting"
            }
        }
    };
    const { subject, message } = await (0, taskActivities_1.translateAndFormatTaskNotificationActivity)({
        task: realTask,
        member: { email: 'sergio@uncodie.com', name: 'Sergio Prado', role: 'assignee' },
        timeWindowHours: 24
    });
    console.log('Enviando recordatorio de tarea con ID real...');
    await apiService_1.apiService.post('/api/notifications/taskReminder', {
        email: email,
        subject: subject,
        message: message,
        site_id: '9be0a6a2-5567-41bf-ad06-cb4014f0faf2',
        locale: 'es'
    });
    const { subject: leadSubject, message: leadMessage } = await (0, taskActivities_1.translateAndFormatTaskNotificationActivity)({
        task: realTask,
        member: { email: 'gerencia@transarielsur.com', name: 'Mauricio Aranza', role: 'lead' },
        timeWindowHours: 24
    });
    // Sending the lead version to Sergio as well to see how it looks
    console.log('Enviando recordatorio de tarea para el Lead con ID real...');
    await apiService_1.apiService.post('/api/notifications/taskReminder', {
        email: email,
        subject: leadSubject,
        message: leadMessage,
        site_id: '9be0a6a2-5567-41bf-ad06-cb4014f0faf2',
        locale: 'es'
    });
    console.log('✅ Correos de prueba enviados con éxito!');
}
sendTestEmails().catch(console.error);
