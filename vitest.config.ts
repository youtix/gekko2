import path from 'node:path';

export default {
  test: {
    mockReset: true,
    coverage: {
      reporter: ['text'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.{schema,mock,types,error,const}.ts', 'src/**/index.ts', 'src/strategies/custom/**/*.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 90,
        statements: 80,
      },
    },
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
