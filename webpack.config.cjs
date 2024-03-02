const path = require('path');
const webpack = require("webpack");

module.exports = {
    entry: "./src/cli.ts",
    target: "node",
    mode: "production",
    module: {
        rules: [
            {
                test: /\.ts$/,
                use: "ts-loader",
                exclude: /node_modules/,
            },
        ],
    },
    plugins: [
        new webpack.BannerPlugin({ banner: "#!/usr/bin/env node", raw: true }),
    ],
    resolve: {
        extensions: [".ts", ".js"],
    },
    output: {
        filename: "cli.mjs",
        path: path.resolve(__dirname, "dist"),
        chunkFormat: "module",
        module: true
    },
    experiments: {
        outputModule: true
    }
};
