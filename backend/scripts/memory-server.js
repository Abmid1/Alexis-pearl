/**
 * Run the backend against an in-memory database loaded with the demo seed.
 * For local demos and UI work without touching Supabase. Data resets on restart.
 *
 *   npm run dev:memory        → http://localhost:5000
 *
 * Logins (password demo1234) are the same as `npm run seed`.
 * The AI key is ignored here so demo data never leaves your machine.
 */
import { createFakeDb } from '../test/helpers/fakeDb.js';

globalThis.__BILT_TEST_DB__ = createFakeDb();
process.env.JWT_SECRET ||= 'memory-dev-secret';

const { run } = await import('./seed.js');
delete process.env.GEMINI_API_KEY;      // seed.js loads .env — keep the demo offline
delete process.env.WHATSAPP_TOKEN;
delete process.env.PAYSTACK_SECRET_KEY;
await run();

const { createApp } = await import('../src/app.js');
const PORT = process.env.PORT || 5000;
createApp().listen(PORT, () => console.log(`Bilt Africa backend (in-memory demo) on :${PORT}`));
