import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  // Allow public access to API endpoints for testing
  const { pathname } = request.nextUrl
  
  // List of API endpoints that should be publicly accessible
  const publicApiPaths = [
    '/api/status',
    '/api/worker', 
    '/api/schedules',
    '/api/execute'
  ]
  
  // Check if the request is for a public API endpoint
  const isPublicApiPath = publicApiPaths.some(path => pathname.startsWith(path))
  
  if (isPublicApiPath) {
    // Clone the request headers
    const requestHeaders = new Headers(request.headers)
    
    // Add headers to bypass Vercel authentication for API endpoints
    requestHeaders.set('x-middleware-bypass-auth', 'true')
    
    // Continue to the API endpoint without authentication
    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    })
  }
  
  // For all other routes, continue with normal processing (authentication if enabled)
  return NextResponse.next()
}

export const config = {
  // Match all API routes
  matcher: [
    '/api/:path*'
  ]
} 