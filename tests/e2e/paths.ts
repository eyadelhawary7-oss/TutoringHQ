import path from 'path';

/** Centre-owner session written by global.setup.ts */
export const CENTRE_OWNER_AUTH_FILE = path.join(__dirname, '.auth', 'centre-owner.json');

/** Super-admin session written by super-admin.setup.ts */
export const SUPER_ADMIN_AUTH_FILE = path.join(__dirname, '.auth', 'super-admin.json');
