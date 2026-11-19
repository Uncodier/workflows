import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

/** Isolated in-memory PostgreSQL, outside Jest's VM, using only the existing
 * sibling fixture dependency. No application configuration or credentials. */
export function localPglite(): { query: Function; exec: Function; close: Function } {
  // Run PGlite outside Jest's VM, as the existing dispatcher SQL suite does.
  const child = spawn(process.execPath, ['-e', `
    const { PGlite } = require(process.argv[1]);
    const db = new PGlite({ parsers: { 20: value => value } });
    let queue = Promise.resolve();
    process.on('message', request => { queue = queue.then(async () => {
      try { const result = await db[request.method](...request.args); process.send({ id: request.id, result }); }
      catch (error) { process.send({ id: request.id, error: { message: error.message, code: error.code } }); }
      if (request.method === 'close') process.disconnect();
    }); });
  `, resolve(__dirname, '../../../API/node_modules/@electric-sql/pglite')], { stdio: ['ignore','ignore','inherit','ipc'], env: { PATH: process.env.PATH } });
  let id = 0;
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: any) => void }>();
  child.on('message', (reply: any) => {
    const request = pending.get(reply.id); pending.delete(reply.id);
    if (reply.error) request?.reject(reply.error); else request?.resolve(reply.result);
  });
  const fail = (error: any) => { for (const request of pending.values()) request.reject(error); pending.clear(); };
  child.on('error', fail); child.on('exit', code => fail(new Error(`SQL fixture exited: ${code}`)));
  return Object.fromEntries(['query','exec','close'].map(method => [method, (...args: any[]) => new Promise((resolve,reject) => {
    pending.set(++id, { resolve,reject }); child.send({ id,method,args });
  })])) as { query: Function; exec: Function; close: Function };
}
