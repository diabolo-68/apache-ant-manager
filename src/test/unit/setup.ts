/**
 * Mocha `--require` hook: routes `require('vscode')` to the in-memory stub.
 */
import Module = require('module');
import * as stub from './vscodeStub';

const mod = Module as unknown as { _resolveFilename: (request: string, ...rest: unknown[]) => string };
const originalResolve = mod._resolveFilename;
const STUB_ID = '\0vscode-stub';

mod._resolveFilename = function (request: string, ...rest: unknown[]) {
    return request === 'vscode' ? STUB_ID : originalResolve.call(this, request, ...rest);
};
require.cache[STUB_ID] = { id: STUB_ID, filename: STUB_ID, loaded: true, exports: stub } as unknown as NodeJS.Module;
