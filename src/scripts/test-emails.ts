import { apiService } from '../temporal/services/apiService';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Asegurarse de que las variables de entorno se carguen correctamente
dotenv.config({ path: resolve(process.cwd(), '.env') });
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

async function sendTestEmails() {
  const email = 'sergio@uncodie.com';

  console.log(`Enviando correos de prueba a: ${email}...`);

  // 1. Reservation 24h
  const res24 = `
# Recordatorio de Reservación

Hola Sergio,

Este es un recordatorio de que tienes una reservación programada próximamente.

**Detalles de la reserva:**
- **Fecha:** lunes, 17 de agosto de 2026
- **Horario:** 14:00 a 15:00 (Zona Horaria: America/Mexico_City)
- **Servicio:** Consultoría Estratégica
- **Ubicación:** Reunión en línea (Digital Meet Room)
- **Notas:** Por favor llega 10 minutos antes.

Por favor, ponte en contacto si necesitas realizar algún cambio.

¡Gracias!
  `.trim();

  console.log('Enviando recordatorio de 24 horas...');
  await apiService.post('/api/notifications/reservationReminder', {
    email: email,
    subject: 'Recordatorio: Tu reservación es mañana',
    message: res24,
    site_id: 'd74096c4-14e6-471b-8c68-e059af438bc2',
    locale: 'es'
  });

  // 2. Reservation 1h
  const res1 = `
# Recordatorio de Reservación

Hola Sergio,

Este es un recordatorio de que tienes una reservación programada próximamente.

**Detalles de la reserva:**
- **Fecha:** domingo, 16 de agosto de 2026
- **Horario:** 18:00 a 19:00 (Zona Horaria: America/Mexico_City)
- **Servicio:** Sesión Presencial de Revisión
- **Ubicación:** Oficina Central - Av. Principal 123, Ciudad
- **Notas:** Traer laptop.

Por favor, ponte en contacto si necesitas realizar algún cambio.

¡Gracias!
  `.trim();

  console.log('Enviando recordatorio de 1 hora...');
  await apiService.post('/api/notifications/reservationReminder', {
    email: email,
    subject: 'Recordatorio: Tu reservación es en 1 hora',
    message: res1,
    site_id: 'd74096c4-14e6-471b-8c68-e059af438bc2',
    locale: 'es'
  });

  // 3. Subscription Renewal
  const sub = `
# Recibo de Suscripción

Hola Sergio,

Tu suscripción ha sido renovada exitosamente.

**Detalles de la transacción:**
- **Fecha:** 16/8/2026
- **Monto Total:** $49.99 USD
- **Número de Orden:** test-sale-id-12345
- **Próximo Cobro:** 16/9/2026

[Ver Detalles de la Orden de Compra (SO)](https://makinari.com/so/ya5q-RfUeU2tA98P0rne6nQmi1LEJk8q)

Gracias por tu preferencia. Si tienes alguna duda, responde a este correo.
  `.trim();

  console.log('Enviando recibo de suscripción...');
  await apiService.post('/api/notifications/subscriptionRenewal', {
    email: email,
    subject: 'Recibo de Renovación de Suscripción',
    message: sub,
    site_id: 'd74096c4-14e6-471b-8c68-e059af438bc2',
    locale: 'es'
  });

  console.log('✅ Correos de prueba enviados con éxito!');
}

sendTestEmails().catch(console.error);
