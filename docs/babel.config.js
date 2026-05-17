module.exports = function (api) {
  const isEsBuild = process.env.BUILD_TYPE === 'esbuild';
  api.cache(true);
  return {
    presets: isEsBuild
      ? []
      : [
          [
            require.resolve('@docusaurus/core/lib/babel/preset'),
            { debug: !!process.env.DEBUG },
          ],
        ],
  };
};