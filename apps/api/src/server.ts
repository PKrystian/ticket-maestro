import { app } from './app.js';
import { config } from './config.js';

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(JSON.stringify({ level: 'info', message: 'TicketMaestro API listening', port: config.port }));
});

function shutdown(signal: string) {
  console.log(JSON.stringify({ level: 'info', message: 'graceful shutdown', signal }));
  server.close(error => { if (error) process.exitCode = 1; process.exit(); });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
