import { createApp } from './app.js';
import { env } from './config/env.js';

const { server, close } = createApp(env);
server.listen(env.port, '0.0.0.0', () => console.log(`Dropmine: http://localhost:${env.port}`));
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 10_000);
  deadline.unref();
  void close().then(() => process.exit(0)).catch(() => process.exit(1));
});
