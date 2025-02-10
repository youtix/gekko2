import path from 'node:path';

export default {
  test: {
    mockReset: true,
  },
  resolve: {
    alias: {
      '@constants': path.resolve(__dirname, './src/constants'),
      '@models': path.resolve(__dirname, './src/models'),
      '@errors': path.resolve(__dirname, './src/errors'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@services': path.resolve(__dirname, './src/services'),
      '@indicators': path.resolve(__dirname, './src/indicators'),
      '@strategies': path.resolve(__dirname, './src/strategies'),
      '@plugins': path.resolve(__dirname, './src/plugins'),
    },
  },
};
