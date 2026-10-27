module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // must stay last (drawer animations)
    plugins: ['react-native-reanimated/plugin'],
  };
};
