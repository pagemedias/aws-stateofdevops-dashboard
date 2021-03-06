const TerserPlugin = require("terser-webpack-plugin");
const CopyPlugin = require("copy-webpack-plugin");

module.exports = {
    entry: {
        DynamoStream: "./src/dynamoStream.ts",
        StateChangeHandler: "./src/stateChangeHandler.ts",
        StateOfDevopsDashboard: "./src/stateOfDevopsDashboardHandler.ts",
        ServiceHealthAlarmGenerator: "./src/serviceHealthAlarmGenerator.ts",
    },
    output: {
        filename: "src/[name]/index.js",
        path: __dirname + "/.dist/",
        libraryTarget: "commonjs2",
    },
    devtool: "source-map",
    resolve: {
        extensions: [".ts", ".js"],
    },
    target: "node",
    externals: ["aws-sdk"], //process.env.NODE_ENV === "development" ? [] : ["aws-sdk"],
    mode: process.env.NODE_ENV || "production",
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                loader: "babel-loader",
            },
        ],
    },
    optimization: {
        minimizer: [
            new TerserPlugin({
                terserOptions: {
                    keep_classnames: true,
                },
            }),
        ],
    },
    plugins: [new CopyPlugin([{ from: "*template.yml" }, { from: "*LICENSE" }, { from: "*README*" }])],
};
