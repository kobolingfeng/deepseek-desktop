// Shared app metadata read from app.config.json — single source of truth for the exe name,
// product name, and version used by build / dev / package.
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(import.meta.dir, '..');
let cfg: Record<string, unknown> = {};
try {
    cfg = JSON.parse(readFileSync(join(root, 'app.config.json'), 'utf8'));
} catch {
    /* fall back to defaults below */
}

const win = (cfg.window as Record<string, unknown>) || {};

export function sanitizeName(value: string): string {
    return (
        value
            .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/[. ]+$/g, '') || 'app'
    );
}

/** Base name for the executable (no extension). */
export const APP_NAME: string = (cfg.name as string) || (win.title as string) || 'app';
/** Human-facing product name (VERSIONINFO, About page). */
export const PRODUCT_NAME: string = (cfg.productName as string) || (win.title as string) || APP_NAME;
/** Semver string, e.g. "1.0.0". */
export const APP_VERSION: string = (cfg.version as string) || '0.0.0';
/** Output executable file name, e.g. "DSDesktop.exe". */
export const EXE_NAME: string = sanitizeName(APP_NAME) + '.exe';
