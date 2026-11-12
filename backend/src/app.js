import Fastify from 'fastify';

export function buildApp(db) {
  const app = Fastify({ logger: true });
  app.get('/api/health', async () => ({ status: 'ok' }));
  app.get('/api/gateways', async () => db.prepare('SELECT * FROM gateways ORDER BY id').all());
  app.get('/api/sensors', async () => db.prepare('SELECT * FROM sensors ORDER BY id').all());
  return app;
}
