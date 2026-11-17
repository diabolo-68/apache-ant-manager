import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Create a fresh temporary directory (removed by `cleanup`). */
export function tempDir(prefix = 'task-manager-'): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function cleanup(dir: string): void {
    fs.rmSync(dir, { recursive: true, force: true });
}

export function write(file: string, content: string): string {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
    return file;
}

export function readJson(file: string): any {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}
