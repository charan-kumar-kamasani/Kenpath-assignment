import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { api } from './routes.js';
import { seedIfEmpty } from './seed.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.get('/healthz', (_req, res) => res.send('ok'));
app.use('/api', api);
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), '../public')));
app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));

seedIfEmpty();
const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`రైతు సేవ running on http://localhost:${port}  (AI: ${process.env.ANTHROPIC_API_KEY ? 'Claude' : 'rule-based fallback'})`));
