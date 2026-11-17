/**
 * Records a Playwright-driven VS Code session as an animated GIF, for the README.
 *
 * Screenshots are taken continuously in the background while the scenario runs. Screenshots
 * do not show the mouse pointer, so the recorder moves the mouse itself (see moveTo / click)
 * and paints a pointer into every frame. Identical consecutive frames are merged, and frames
 * are downscaled before encoding to keep the file small. Pure JS: no ffmpeg needed.
 */
import type { Locator, Page } from '@playwright/test';
import * as fs from 'fs';
import { PNG } from 'pngjs';
import { GIFEncoder, applyPalette, quantize } from 'gifenc';

interface Frame { png: Buffer; time: number; x: number; y: number; clickedAt: number }

/** Classic arrow pointer: X = outline, . = fill. */
const POINTER = [
    'X',
    'XX',
    'X.X',
    'X..X',
    'X...X',
    'X....X',
    'X.....X',
    'X......X',
    'X.......X',
    'X........X',
    'X.........X',
    'X......XXXXX',
    'X...X..X',
    'X..XX..X',
    'X.X  X..X',
    'XX   X..X',
    'X     X..X',
    '      X..X',
    '       XX'
];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export class GifRecorder {
    private readonly _frames: Frame[] = [];
    private _running = false;
    private _loop?: Promise<void>;
    private _x: number;
    private _y: number;
    private _clickedAt = 0;

    constructor(private readonly _page: Page, start = { x: 640, y: 400 }) {
        this._x = start.x;
        this._y = start.y;
    }

    start(): void {
        this._running = true;
        this._loop = (async () => {
            while (this._running) {
                const started = Date.now();
                const png = await this._page.screenshot({ animations: 'allow', caret: 'initial' }).catch(() => undefined);
                if (png) {
                    this._frames.push({ png, time: started, x: this._x, y: this._y, clickedAt: this._clickedAt });
                }
                await sleep(Math.max(0, 90 - (Date.now() - started))); // ~10 fps at most
            }
        })();
    }

    async stop(): Promise<void> {
        this._running = false;
        await this._loop;
    }

    /** Hold the current picture for `ms` (frames are captured meanwhile). */
    pause(ms: number): Promise<void> {
        return this._page.waitForTimeout(ms);
    }

    /** Glide the mouse to the centre of `target`. */
    async moveTo(target: Locator): Promise<void> {
        await target.waitFor();
        const box = await target.boundingBox();
        if (!box) { throw new Error('target has no bounding box'); }
        const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        const from = { x: this._x, y: this._y };
        const steps = Math.max(8, Math.round(Math.hypot(to.x - from.x, to.y - from.y) / 25));
        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
            this._x = from.x + (to.x - from.x) * ease;
            this._y = from.y + (to.y - from.y) * ease;
            await this._page.mouse.move(this._x, this._y);
            await sleep(16);
        }
    }

    async click(target: Locator): Promise<void> {
        await this.moveTo(target);
        await this.pause(250);
        this._clickedAt = Date.now();
        await this._page.mouse.click(this._x, this._y);
        await this.pause(300);
    }

    /** Click into a field and type like a person would. */
    async type(target: Locator, text: string, { clear = false } = {}): Promise<void> {
        await this.click(target);
        if (clear) { await target.selectText(); }
        await target.pressSequentially(text, { delay: 70 });
    }

    /**
     * Encode the recording. `width` is the GIF width in pixels; the last frame is held for
     * `holdLastMs` before the animation loops.
     */
    async save(file: string, { width = 960, holdLastMs = 3000 } = {}): Promise<void> {
        await this.stop();
        const cssWidth = await this._page.evaluate(() => window.innerWidth);

        // Merge identical consecutive frames (same picture, same pointer, no click ring).
        const unique: { frame: Frame; duration: number }[] = [];
        for (let i = 0; i < this._frames.length; i++) {
            const frame = this._frames[i];
            const next = this._frames[i + 1];
            const duration = next ? next.time - frame.time : holdLastMs;
            const prev = unique.at(-1);
            if (prev && prev.frame.png.equals(frame.png) && prev.frame.x === frame.x && prev.frame.y === frame.y
                && !ringVisible(prev.frame) && !ringVisible(frame)) {
                prev.duration += duration;
            } else {
                unique.push({ frame, duration });
            }
        }
        if (unique.length) { unique[unique.length - 1].duration = Math.max(unique.at(-1)!.duration, holdLastMs); }

        const gif = GIFEncoder();
        for (const { frame, duration } of unique) {
            const src = PNG.sync.read(frame.png);
            const scale = width / src.width;
            const height = Math.round(src.height * scale);
            const rgba = downscale(src.data, src.width, src.height, width, height);
            const pointerScale = (src.width / cssWidth) * scale; // CSS px → GIF px
            if (ringVisible(frame)) {
                drawRing(rgba, width, height, frame.x * pointerScale, frame.y * pointerScale, 1 - (frame.time - frame.clickedAt) / 400);
            }
            drawPointer(rgba, width, height, Math.round(frame.x * pointerScale), Math.round(frame.y * pointerScale));
            const palette = quantize(rgba, 256);
            gif.writeFrame(applyPalette(rgba, palette), width, height, { palette, delay: duration });
        }
        gif.finish();
        fs.writeFileSync(file, gif.bytes());
    }
}

function ringVisible(frame: Frame): boolean {
    const age = frame.time - frame.clickedAt;
    return age >= 0 && age < 400;
}

/** Box-filter downscale of an RGBA buffer. */
function downscale(src: Buffer, sw: number, sh: number, dw: number, dh: number): Uint8Array {
    const out = new Uint8Array(dw * dh * 4);
    const fx = sw / dw;
    const fy = sh / dh;
    for (let y = 0; y < dh; y++) {
        const y0 = Math.floor(y * fy);
        const y1 = Math.max(y0 + 1, Math.floor((y + 1) * fy));
        for (let x = 0; x < dw; x++) {
            const x0 = Math.floor(x * fx);
            const x1 = Math.max(x0 + 1, Math.floor((x + 1) * fx));
            let r = 0, g = 0, b = 0, n = 0;
            for (let sy = y0; sy < y1; sy++) {
                for (let sx = x0; sx < x1; sx++) {
                    const i = (sy * sw + sx) * 4;
                    r += src[i]; g += src[i + 1]; b += src[i + 2]; n++;
                }
            }
            const o = (y * dw + x) * 4;
            out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
        }
    }
    return out;
}

function setPixel(rgba: Uint8Array, w: number, h: number, x: number, y: number, c: number[], alpha = 1): void {
    if (x < 0 || y < 0 || x >= w || y >= h) { return; }
    const i = (y * w + x) * 4;
    for (let k = 0; k < 3; k++) { rgba[i + k] = rgba[i + k] * (1 - alpha) + c[k] * alpha; }
}

function drawPointer(rgba: Uint8Array, w: number, h: number, x: number, y: number): void {
    POINTER.forEach((row, dy) => [...row].forEach((ch, dx) => {
        if (ch === 'X') { setPixel(rgba, w, h, x + dx, y + dy, [0, 0, 0]); }
        if (ch === '.') { setPixel(rgba, w, h, x + dx, y + dy, [255, 255, 255]); }
    }));
}

/** A fading ring around a click. */
function drawRing(rgba: Uint8Array, w: number, h: number, cx: number, cy: number, strength: number): void {
    const radius = 16 - 6 * strength;
    for (let y = Math.floor(cy - radius - 2); y <= cy + radius + 2; y++) {
        for (let x = Math.floor(cx - radius - 2); x <= cx + radius + 2; x++) {
            const d = Math.abs(Math.hypot(x - cx, y - cy) - radius);
            if (d < 2) { setPixel(rgba, w, h, x, y, [0, 122, 204], 0.85 * strength * (1 - d / 2)); }
        }
    }
}
