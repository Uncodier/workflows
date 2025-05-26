import type { NextApiRequest, NextApiResponse } from 'next';
import { startWorker } from '../src/temporal/workers/worker';

let worker: any = null;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // If worker is already running, return success
    if (worker) {
      return res.status(200).json({ status: 'Worker already running' });
    }

    // Start the worker
    worker = await startWorker();

    res.status(200).json({ status: 'Worker started successfully' });
  } catch (error) {
    console.error('Failed to start worker:', error);
    res.status(500).json({ error: 'Failed to start worker' });
  }
} 