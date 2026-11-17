import * as assert from 'assert';
import * as path from 'path';
import { AntParserService } from '../../services/AntParserService';
import { displayBuildFile, isAntBuildFile } from '../../util/antFiles';
import { escapeHtml, getNonce, icon } from '../../panels/webviewUtils';
import * as vscode from './vscodeStub';
import { cleanup, tempDir, write } from './helpers';

suite('AntParserService (XML parser)', () => {
    let root: string;
    let parser: AntParserService;

    setup(() => {
        root = tempDir();
        vscode.reset([root]);
        parser = new AntParserService({ extensionPath: root } as any);
    });
    teardown(() => cleanup(root));

    test('reads project attributes and targets', async () => {
        const file = write(path.join(root, 'build.xml'), `<?xml version="1.0"?>
<project name="demo" default="dist" basedir=".">
    <target name="init"/>
    <target name="compile" depends="init" description="Compile sources">
        <javac srcdir="src"/>
    </target>
    <target name='dist' depends='compile, init' description='Build the jar'/>
    <target name="maybe" if="flag" unless="other" description="Only if flag is set"/>
</project>`);
        const info = await parser.parseBuildFile(file);
        assert.strictEqual(info.projectName, 'demo');
        assert.strictEqual(info.defaultTarget, 'dist');
        assert.strictEqual(info.baseDir, root);
        assert.deepStrictEqual(info.targets.map(t => t.name), ['compile', 'dist', 'init', 'maybe']);
        const dist = info.targets.find(t => t.name === 'dist')!;
        assert.deepStrictEqual(dist.dependencies, ['compile', 'init']);
        assert.strictEqual(dist.description, 'Build the jar');
        assert.strictEqual(dist.isDefault, true);
        const maybe = info.targets.find(t => t.name === 'maybe')!;
        assert.strictEqual(maybe.ifCondition, 'flag');
        assert.strictEqual(maybe.unlessCondition, 'other');
        assert.strictEqual(info.targets.find(t => t.name === 'init')!.description, null);
    });

    test('attribute names are matched whole (no "if" inside "description")', async () => {
        const file = write(path.join(root, 'build.xml'),
            `<project name="p" default="a"><target description="runs if=x" name="a"/></project>`);
        const [target] = (await parser.parseBuildFile(file)).targets;
        assert.strictEqual(target.name, 'a');
        assert.strictEqual(target.ifCondition, null);
    });

    test('follows imports up to the configured depth and ignores cycles', async () => {
        write(path.join(root, 'common', 'level1.xml'), `<project name="l1"><import file="level2.xml"/><target name="from-l1"/></project>`);
        write(path.join(root, 'common', 'level2.xml'), `<project name="l2"><import file="../build.xml"/><target name="from-l2"/></project>`);
        const main = write(path.join(root, 'build.xml'),
            `<project name="main" default="main"><import file="common/level1.xml"/><include file="\${basedir}/x.xml"/><target name="main"/></project>`);

        vscode.state.config['apacheAntManager.importDepth'] = 1;
        let names = (await parser.parseBuildFile(main)).targets.map(t => t.name);
        assert.deepStrictEqual(names, ['from-l1', 'main']);

        parser.clearCache();
        vscode.state.config['apacheAntManager.importDepth'] = 5;
        names = (await parser.parseBuildFile(main)).targets.map(t => t.name);
        assert.deepStrictEqual(names, ['from-l1', 'from-l2', 'main']);
    });

    test('caches results until cleared', async () => {
        const file = write(path.join(root, 'build.xml'), `<project name="p" default="a"><target name="a"/></project>`);
        assert.strictEqual((await parser.parseBuildFile(file)).targets.length, 1);
        write(file, `<project name="p" default="a"><target name="a"/><target name="b"/></project>`);
        assert.strictEqual((await parser.parseBuildFile(file)).targets.length, 1);
        parser.clearCache(file);
        assert.strictEqual((await parser.parseBuildFile(file)).targets.length, 2);
    });

    test('falls back to the XML parser when the Java parser is unavailable', async () => {
        vscode.state.config['apacheAntManager.useJavaParser'] = true;
        vscode.state.config['apacheAntManager.javaHome'] = path.join(root, 'no-such-jdk');
        const file = write(path.join(root, 'build.xml'), `<project name="p" default="a"><target name="a"/></project>`);
        const info = await parser.parseBuildFile(file);
        assert.deepStrictEqual(info.targets.map(t => t.name), ['a']);
    });
});

suite('antFiles', () => {
    let root: string;
    setup(() => { root = tempDir(); vscode.reset([root]); });
    teardown(() => cleanup(root));

    test('isAntBuildFile recognises Ant projects only', async () => {
        assert.ok(await isAntBuildFile(write(path.join(root, 'a.xml'), '<project name="x" default="y"></project>')));
        assert.ok(await isAntBuildFile(write(path.join(root, 'b.xml'), '<!DOCTYPE project>\n<project></project>')));
        assert.ok(await isAntBuildFile(write(path.join(root, 'c.xml'), '<project xmlns:if="ant:if" basedir="."/>')));
        assert.ok(!(await isAntBuildFile(write(path.join(root, 'pom.xml'), '<project xmlns="http://maven.apache.org/POM/4.0.0"></project>'))));
        assert.ok(!(await isAntBuildFile(write(path.join(root, 'd.xml'), '<settings/>'))));
        assert.ok(!(await isAntBuildFile(path.join(root, 'missing.xml'))));
    });

    test('displayBuildFile shortens workspace paths', () => {
        assert.strictEqual(displayBuildFile('${workspaceFolder}/sub/build.xml'), 'sub/build.xml');
        assert.strictEqual(displayBuildFile('${workspaceFolder:app}/build.xml'), 'build.xml');
        assert.strictEqual(displayBuildFile(path.join(root, 'x', 'build.xml')), path.join('x', 'build.xml'));
        assert.strictEqual(displayBuildFile(undefined), 'Unknown build file');
    });
});

suite('webviewUtils', () => {
    test('escapeHtml escapes markup and quotes', () => {
        assert.strictEqual(escapeHtml(`<a href="x" title='y'>&</a>`), '&lt;a href=&quot;x&quot; title=&#039;y&#039;&gt;&amp;&lt;/a&gt;');
        assert.strictEqual(escapeHtml(undefined), '');
    });

    test('getNonce is 32 alphanumeric characters and random', () => {
        const a = getNonce();
        assert.match(a, /^[A-Za-z0-9]{32}$/);
        assert.notStrictEqual(a, getNonce());
    });

    test('icon renders an aria-hidden codicon', () => {
        assert.strictEqual(icon('play'), '<i class="codicon codicon-play" aria-hidden="true"></i>');
    });
});
