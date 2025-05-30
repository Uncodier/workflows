import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isProduction = process.env.NODE_ENV === 'production'
  
  // En producción, verificar autenticación para todas las rutas API
  if (isProduction && pathname.startsWith('/api/')) {
    const apiKey = process.env.API_KEY
    
    if (!apiKey) {
      console.error('API_KEY no está configurada en las variables de entorno')
      return new NextResponse(
        JSON.stringify({ error: 'Server configuration error' }),
        { 
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    }
    
    // Verificar header x-api-key o authorization
    const xApiKey = request.headers.get('x-api-key')
    const authHeader = request.headers.get('authorization')
    
    let providedKey: string | null = null
    
    if (xApiKey) {
      providedKey = xApiKey
    } else if (authHeader) {
      // Soportar formato "Bearer API_KEY" o solo "API_KEY"
      providedKey = authHeader.startsWith('Bearer ') 
        ? authHeader.substring(7) 
        : authHeader
    }
    
    if (!providedKey || providedKey !== apiKey) {
      return new NextResponse(
        JSON.stringify({ 
          error: 'Unauthorized',
          message: 'Valid API key required in x-api-key or authorization header'
        }),
        { 
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    }
  }
  
  // En desarrollo, mantener el comportamiento anterior para endpoints públicos
  if (!isProduction) {
    const publicApiPaths = [
      '/api/health',
      '/api/status',
      '/api/worker', 
      '/api/schedules',
      '/api/execute'
    ]
    
    const isPublicApiPath = publicApiPaths.some(path => 
      pathname === path || pathname.startsWith(path + '/')
    )
    
    if (isPublicApiPath) {
      const requestHeaders = new Headers(request.headers)
      
      requestHeaders.set('x-middleware-bypass-auth', 'true')
      requestHeaders.set('x-vercel-bypass-protection', 'true')
      requestHeaders.set('x-public-endpoint', 'true')
      
      requestHeaders.delete('authorization')
      requestHeaders.delete('cookie')
      
      const response = NextResponse.next({
        request: {
          headers: requestHeaders,
        },
      })
      
      response.headers.set('x-public-access', 'true')
      response.headers.set('Access-Control-Allow-Origin', '*')
      
      return response
    }
  }
  
  // Para todas las demás rutas, continuar con el procesamiento normal
  return NextResponse.next()
}

export const config = {
  // Aplicar middleware a todas las rutas API y algunos paths específicos
  matcher: [
    '/api/:path*',
    '/health.json'
  ]
} 