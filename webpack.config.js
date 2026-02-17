const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const webpack = require("webpack");

// Read environment variables from .env file
require("dotenv").config({ path: "./.env" });

const isDevelopment = process.env.NODE_ENV !== "production";

// Determine the network from DFX_NETWORK or default
const network = process.env.DFX_NETWORK || (isDevelopment ? "local" : "ic");

// Build environment variables for canister IDs
function initCanisterEnv() {
  const canisterEnv = {};
  for (const key in process.env) {
    if (key.startsWith("CANISTER_ID_")) {
      canisterEnv[`process.env.${key}`] = JSON.stringify(process.env[key]);
    }
  }
  canisterEnv["process.env.DFX_NETWORK"] = JSON.stringify(network);
  return canisterEnv;
}

module.exports = {
  target: "web",
  mode: isDevelopment ? "development" : "production",
  entry: {
    index: path.join(__dirname, "src", "viewer_frontend", "src", "index.jsx"),
  },
  devtool: isDevelopment ? "source-map" : false,
  optimization: {
    minimize: !isDevelopment,
  },
  resolve: {
    extensions: [".js", ".jsx", ".json"],
    fallback: {
      assert: false,
      buffer: false,
      events: false,
      http: false,
      https: false,
      os: false,
      path: false,
      stream: false,
      url: false,
      util: false,
      zlib: false,
    },
  },
  output: {
    filename: "index.js",
    path: path.join(__dirname, "dist", "viewer_frontend"),
    clean: true,
  },
  module: {
    rules: [
      {
        test: /\.(js|jsx)$/,
        exclude: /node_modules/,
        use: {
          loader: "babel-loader",
          options: {
            presets: ["@babel/preset-env", "@babel/preset-react"],
          },
        },
      },
      {
        test: /\.css$/,
        use: ["style-loader", "css-loader"],
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: path.join(
        __dirname,
        "src",
        "viewer_frontend",
        "src",
        "index.html"
      ),
      filename: "index.html",
    }),
    new webpack.DefinePlugin(initCanisterEnv()),
    new webpack.ProvidePlugin({
      Buffer: ["buffer", "Buffer"],
    }),
  ],
  devServer: {
    port: 3000,
    proxy: [
      {
        context: ["/api"],
        target: "http://127.0.0.1:4943",
        changeOrigin: true,
      },
    ],
    hot: true,
    static: {
      directory: path.resolve(__dirname, "src", "viewer_frontend", "assets"),
    },
  },
};
