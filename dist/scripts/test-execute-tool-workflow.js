#!/usr/bin/env ts-node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.testExecuteToolWorkflow = testExecuteToolWorkflow;
require('dotenv/config');
const temporalToolExecutor_1 = require("../temporal/client/temporalToolExecutor");
async function testExecuteToolWorkflow() {
    console.log('🧪 Testing Execute Tool Workflow...');
    try {
        const executor = new temporalToolExecutor_1.TemporalToolExecutor();
        // Ejemplo 1: Llamada GET simple a API externa
        console.log('\n1️⃣ Testing external GET API call...');
        const weatherToolInput = {
            toolName: 'get-weather',
            args: {
                location: 'Madrid',
                units: 'metric'
            },
            apiConfig: {
                endpoint: {
                    url: 'https://api.openweathermap.org/data/2.5/weather',
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    requiresAuth: true,
                    authType: 'ApiKey'
                },
                responseMapping: {
                    temperature: 'main.temp',
                    description: 'weather[0].description',
                    city: 'name'
                }
            },
            environment: {
                WEATHER_API_KEY: process.env.WEATHER_API_KEY || 'demo-key'
            }
        };
        const weatherResult = await executor.executeTool(weatherToolInput);
        console.log('Weather API Result:', JSON.stringify(weatherResult, null, 2));
        // Ejemplo 2: Llamada POST a API local
        console.log('\n2️⃣ Testing local POST API call...');
        const localApiInput = {
            toolName: 'create-task',
            args: {
                title: 'Test Task',
                description: 'This is a test task created via Temporal workflow',
                priority: 'high'
            },
            apiConfig: {
                endpoint: {
                    url: '/api/tasks',
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    requiresAuth: true,
                    authType: 'Bearer'
                },
                errors: {
                    400: { message: 'error.message', code: 'BAD_REQUEST' },
                    401: { message: 'error.details', code: 'UNAUTHORIZED' },
                    500: { message: 'error.message', code: 'SERVER_ERROR' }
                }
            },
            environment: {
                NODE_ENV: process.env.NODE_ENV || 'development',
                PORT: process.env.PORT || '3000',
                SERVICE_API_KEY: process.env.SERVICE_API_KEY || 'demo-api-key'
            }
        };
        const localResult = await executor.executeTool(localApiInput);
        console.log('Local API Result:', JSON.stringify(localResult, null, 2));
        // Ejemplo 3: Llamada GET con parámetros en URL
        console.log('\n3️⃣ Testing GET with URL parameters...');
        const urlParamsInput = {
            toolName: 'get-user-profile',
            args: {
                userId: '123',
                include: 'profile,settings'
            },
            apiConfig: {
                endpoint: {
                    url: '/api/users/{userId}',
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer {{SERVICE_API_KEY}}'
                    },
                    requiresAuth: true,
                    authType: 'Bearer'
                },
                responseMapping: {
                    id: 'data.id',
                    name: 'data.name',
                    email: 'data.email'
                }
            },
            environment: {
                NODE_ENV: 'development',
                PORT: '3000',
                SERVICE_API_KEY: process.env.SERVICE_API_KEY || 'demo-api-key'
            }
        };
        const urlParamsResult = await executor.executeTool(urlParamsInput);
        console.log('URL Params Result:', JSON.stringify(urlParamsResult, null, 2));
        console.log('\n✅ All tests completed!');
    }
    catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}
// Ejecutar si es llamado directamente
if (require.main === module) {
    testExecuteToolWorkflow()
        .then(() => {
        console.log('🎉 Test execution finished');
        process.exit(0);
    })
        .catch((error) => {
        console.error('💥 Test execution failed:', error);
        process.exit(1);
    });
}
