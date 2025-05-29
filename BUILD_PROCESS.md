# 🏗️ Proceso de Build Correcto para Temporal + Vercel

## 🚨 **Problema Identificado**

Anteriormente teníamos **dos fuentes de verdad** para los schedules:
- ✅ **Código TypeScript fuente**: `src/temporal/schedules/index.ts` (correcto)
- ❌ **Archivo JavaScript compilado**: `dist/temporal/schedules/index.js` (desactualizado)

Esto causaba que se crearan schedules no deseados en Temporal Cloud.

## ✅ **Solución Implementada**

### **1. Configuración de Build en `vercel.json`**
```json
{
  "buildCommand": "npm run build:all"
}
```

### **2. Scripts de Build en `package.json`**
```json
{
  "scripts": {
    "build": "next build",                    // ✅ Compila Next.js app
    "worker:build": "tsc -p worker.tsconfig.json",  // ✅ Compila Temporal workers
    "build:all": "npm run build && npm run worker:build"  // ✅ Compila TODO
  }
}
```

### **3. Configuración TypeScript para Workers**
`worker.tsconfig.json`:
```json
{
  "compilerOptions": {
    "outDir": "dist",
    "module": "CommonJS"
  },
  "include": ["src/temporal/**/*", "src/lib/**/*", "src/config/**/*", "src/scripts/**/*"]
}
```

## 🔄 **Flujo de Build Correcto**

### **Desarrollo Local**
```bash
npm run dev:all        # Next.js + Worker en paralelo
```

### **Build Completo**
```bash
npm run build:all      # Next.js + Worker compilados
```

### **Deploy en Vercel**
1. Vercel ejecuta automáticamente: `npm run build:all`
2. Se compilan:
   - ✅ **Next.js app** → `.next/`
   - ✅ **Temporal workers** → `dist/`
3. Los schedules se sincronizan desde el código TypeScript fuente

## 📋 **Checklist Pre-Deploy**

### **Antes de cada deploy:**
- [ ] Verificar que `src/temporal/schedules/index.ts` tenga solo los schedules correctos
- [ ] Ejecutar `npm run build:all` localmente para verificar compilación
- [ ] Comprobar que `dist/temporal/schedules/index.js` refleje los cambios
- [ ] Hacer commit de **ambos** archivos fuente y compilados

### **Scripts útiles:**
```bash
# Compilar solo workers
npm run worker:build

# Verificar schedules
npm run schedule:list

# Eliminar schedule incorrecto
curl "https://your-app.vercel.app/api/delete-schedule?id=sync-emails-schedule"
```

## 🎯 **Arquitectura Final**

### **Schedules Correctos (solo estos 2):**
1. `central-schedule-activities` - Orchestración general
2. `sync-emails-schedule-manager` - Manager que decide qué sitios sincronizar

### **Schedules NUNCA crear:**
- ❌ `sync-emails-schedule` - Ejecutaría workflows individuales automáticamente
- ❌ Cualquier schedule que ejecute `syncEmailsWorkflow` directamente

### **Flujo Correcto:**
```
Temporal Cloud Schedule → syncEmailsScheduleWorkflow → decide qué sitios → syncEmailsWorkflow
```

## 🚀 **Deploy Automático**

Con esta configuración, **Vercel automáticamente**:
1. Ejecuta `npm run build:all`
2. Compila Next.js + Workers
3. Sincroniza schedules desde código fuente
4. Mantiene consistencia entre fuentes

## 🔧 **Troubleshooting**

### **Si hay schedules incorrectos:**
```bash
# Eliminar schedule incorrecto
curl "https://your-app.vercel.app/api/delete-schedule?id=SCHEDULE_ID"

# Verificar schedules actuales
curl "https://your-app.vercel.app/api/schedules"
```

### **Si compilation falla:**
```bash
# Limpiar y recompilar
rm -rf dist .next
npm run build:all
```

---

**✅ Con esta configuración, nunca más tendremos schedules desincronizados.** 