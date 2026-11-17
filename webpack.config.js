//@ts-check

'use strict';

const path = require('path');

/**
 * Prints markers that the background problem matcher in .vscode/tasks.json waits for,
 * so F5 knows when a watch build has started and finished (no extra extension needed).
 * @type {import('webpack').WebpackPluginInstance}
 */
const watchMarkers = {
  apply(compiler) {
    compiler.hooks.watchRun.tap('watch-markers', () => console.log('[watch] build started'));
    compiler.hooks.done.tap('watch-markers', () => {
      if (compiler.watching) { setImmediate(() => console.log('[watch] build finished')); }
    });
  }
};

/**@type {import('webpack').Configuration}*/
const config = {
  plugins: [watchMarkers],
  target: 'node', // VS Code extensions run in a Node.js-context
  mode: 'none', // this leaves the source code as close as possible to the original (when packaging we set this to 'production')
  entry: './src/extension.ts', // the entry point of this extension
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
    devtoolModuleFilenameTemplate: '../[resource-path]'
  },
  devtool: 'source-map',
  externals: {
    vscode: 'commonjs vscode' // the vscode-module is created on-the-fly and must be excluded
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader'
          }
        ]
      }
    ]
  }
};

module.exports = config;
